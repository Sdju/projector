import { onScopeDispose, reactive, watch, type Ref } from "vue";
import {
  answerProblems,
  doctorAnswerSource,
  doctorVerdict,
  formatProblems,
  type AnswerProblem,
} from "../../widget-runtime/index.ts";
import { repairAnswer } from "../../agent-core/index.ts";
import type {
  AgentDoctorProgress,
  AgentDoctorReport,
  AgentPart,
  AgentSelection,
  AgentTurn,
} from "../../agent-core/index.ts";
import { textFingerprint } from "./fingerprint.ts";

/** The saved marks and their tests keep the old name. */
export { textFingerprint as answerFingerprint };

const ANSWER_DOCTOR_ATTEMPTS = 3;

function answerHistory(turns: AgentTurn[]): string {
  return turns
    .slice(-16)
    .map((turn) => `${turn.role === "user" ? "Пользователь" : "Ассистент"}: ${turn.text}`)
    .join("\n\n")
    .slice(-20_000);
}

function replaceAnswer(turn: AgentTurn, text: string): void {
  turn.text = text;
  if (!turn.parts) return;
  let replaced = false;
  const parts: AgentPart[] = [];
  for (const part of turn.parts) {
    if (part.type !== "text") parts.push(part);
    else if (!replaced) {
      parts.push({ type: "text", text });
      replaced = true;
    }
  }
  turn.parts = parts;
}

/** Validates and saves the repaired answer, so a reload does not run the doctor again. */
export function useAnswerDoctor(options: {
  turns: Ref<AgentTurn[]>;
  busy: Ref<boolean>;
  selection?: Ref<AgentSelection>;
  persist: () => void;
  /** The project whose trusted widgets this answer may use. */
  projectId?: string;
}) {
  const attempted = new Map<string, string>();
  const controllers = new Map<string, AbortController>();
  /** What the doctor is doing right now, by turn: the chat shows it under the answer. */
  const progress = reactive(new Map<string, AgentDoctorProgress>());

  /** The saved outcome, but only while the shown text is the one the doctor fixed. */
  function reportFor(turn: AgentTurn): AgentDoctorReport | undefined {
    const report = turn.doctor;
    return report && report.answer === textFingerprint(turn.text) ? report : undefined;
  }

  function remember(turn: AgentTurn, report: AgentDoctorReport): void {
    turn.doctor = report;
    progress.delete(turn.id);
    controllers.delete(turn.id);
    options.persist();
  }

  /** The doctor says the check is wrong: keep the answer, save the reason, stop the round. */
  function accept(
    turn: AgentTurn,
    candidate: string,
    attempts: number,
    problem: string,
    reason: string,
    startedAt: number,
  ): void {
    const current = options.turns.value.find((item) => item.id === turn.id);
    if (current?.text !== turn.text) return;
    if (candidate !== turn.text) replaceAnswer(current, candidate);
    remember(current, {
      status: "accepted",
      attempts,
      problem,
      reason,
      took: Date.now() - startedAt,
      answer: textFingerprint(candidate),
      at: Date.now(),
    });
  }

  async function prepare(turn: AgentTurn): Promise<void> {
    if (turn.role !== "assistant" || attempted.get(turn.id) === turn.text) return;
    // A saved fix or verdict is final for this text; only a failure invites another run.
    const saved = reportFor(turn);
    if (saved && saved.status !== "failed") return;
    attempted.set(turn.id, turn.text);
    controllers.get(turn.id)?.abort();
    controllers.delete(turn.id);
    progress.delete(turn.id);
    const problems: AnswerProblem[] = await answerProblems(turn.text, options.projectId);
    if (attempted.get(turn.id) !== turn.text) return;
    if (!problems.length) {
      // The checker changed or the answer was already fixed: an old failure mark would be a lie.
      if (turn.doctor?.status === "failed") {
        delete turn.doctor;
        options.persist();
      }
      return;
    }
    let candidate = turn.text;
    const original = turn.text;
    let current = problems;
    let diagnosis = formatProblems(problems);
    const originalError = diagnosis;
    let previous: string | undefined;
    const startedAt = Date.now();
    const controller = new AbortController();
    controllers.set(turn.id, controller);
    const alive = () =>
      controllers.get(turn.id) === controller && attempted.get(turn.id) === turn.text;
    for (
      let attempt = 0;
      attempt < ANSWER_DOCTOR_ATTEMPTS && !controller.signal.aborted;
      attempt++
    ) {
      progress.set(turn.id, {
        status: "repairing",
        attempts: attempt + 1,
        limit: ANSWER_DOCTOR_ATTEMPTS,
        problem: originalError,
        ...(diagnosis === originalError ? {} : { remaining: diagnosis }),
      });
      try {
        const reply = await repairAnswer({
          answer: candidate,
          error: diagnosis,
          original,
          originalError,
          previous,
          attempt: attempt + 1,
          limit: ANSWER_DOCTOR_ATTEMPTS,
          history: answerHistory(options.turns.value),
          selection: options.selection?.value,
          signal: controller.signal,
        });
        if (!alive()) return;
        previous = reply;
        const verdict = doctorVerdict(reply);
        if (verdict) {
          if (!current.every((problem) => problem.soft)) {
            // The compiler and broken markup are facts; a verdict cannot waive them.
            const currentTurn = options.turns.value.find((item) => item.id === turn.id);
            if (currentTurn?.text === turn.text) {
              remember(currentTurn, {
                status: "failed",
                attempts: attempt + 1,
                problem: originalError,
                remaining: `${diagnosis}\nВердикт доктора отклонён: ${verdict.reason}`,
                took: Date.now() - startedAt,
                answer: textFingerprint(currentTurn.text),
                at: Date.now(),
              });
            }
            progress.set(turn.id, {
              status: "failed",
              attempts: attempt + 1,
              limit: ANSWER_DOCTOR_ATTEMPTS,
              problem: originalError,
              remaining: `${diagnosis}\nВердикт доктора отклонён: ${verdict.reason}`,
            });
            return;
          }
          accept(turn, candidate, attempt + 1, originalError, verdict.reason, startedAt);
          return;
        }
        const extracted = doctorAnswerSource(reply);
        if (!extracted) {
          diagnosis = "Answer Doctor вернул пустой ответ";
          continue;
        }
        candidate = extracted;
        const next = await answerProblems(candidate, options.projectId);
        if (!alive()) return;
        if (!next.length) {
          const currentTurn = options.turns.value.find((item) => item.id === turn.id);
          if (currentTurn?.text !== turn.text) return;
          replaceAnswer(currentTurn, candidate);
          remember(currentTurn, {
            status: "fixed",
            attempts: attempt + 1,
            problem: originalError,
            took: Date.now() - startedAt,
            answer: textFingerprint(candidate),
            at: Date.now(),
          });
          return;
        }
        current = next;
        diagnosis = formatProblems(next);
      } catch (error) {
        if (!alive()) return;
        diagnosis = error instanceof Error ? error.message : String(error);
      }
    }
    if (!alive()) return;
    const currentTurn = options.turns.value.find((item) => item.id === turn.id);
    if (currentTurn?.text === turn.text) {
      remember(currentTurn, {
        status: "failed",
        attempts: ANSWER_DOCTOR_ATTEMPTS,
        problem: originalError,
        remaining: diagnosis,
        took: Date.now() - startedAt,
        answer: textFingerprint(currentTurn.text),
        at: Date.now(),
      });
    }
    progress.set(turn.id, {
      status: "failed",
      attempts: ANSWER_DOCTOR_ATTEMPTS,
      limit: ANSWER_DOCTOR_ATTEMPTS,
      problem: originalError,
      remaining: diagnosis,
    });
    controllers.delete(turn.id);
  }

  /** A manual retry from the doctor mark: forget the last run and check the answer again. */
  async function retry(turn: AgentTurn): Promise<void> {
    if (turn.role !== "assistant") return;
    attempted.delete(turn.id);
    controllers.get(turn.id)?.abort();
    controllers.delete(turn.id);
    progress.delete(turn.id);
    await prepare(turn);
  }

  watch(
    () =>
      options.busy.value
        ? []
        : options.turns.value
            .filter((turn) => turn.role === "assistant")
            .map((turn) => [turn.id, turn.text] as const),
    (answers) => {
      for (const [id] of answers) {
        const turn = options.turns.value.find((item) => item.id === id);
        if (turn) void prepare(turn);
      }
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    progress.clear();
  });

  return { progress, reportFor, retry };
}
