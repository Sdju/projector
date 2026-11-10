import { onScopeDispose, reactive, watch, type Ref } from "vue";
import { answerProblem, doctorAnswerSource } from "../../widget-runtime/index.ts";
import { repairAnswer } from "../../agent-core/index.ts";
import type {
  AgentDoctorProgress,
  AgentDoctorReport,
  AgentPart,
  AgentSelection,
  AgentTurn,
} from "../../agent-core/index.ts";

const ANSWER_DOCTOR_ATTEMPTS = 3;

/** FNV-1a over the text: a cheap check that a saved report belongs to this answer. */
export function answerFingerprint(text: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

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
    return report && report.answer === answerFingerprint(turn.text) ? report : undefined;
  }

  async function prepare(turn: AgentTurn): Promise<void> {
    if (turn.role !== "assistant" || attempted.get(turn.id) === turn.text) return;
    attempted.set(turn.id, turn.text);
    controllers.get(turn.id)?.abort();
    controllers.delete(turn.id);
    progress.delete(turn.id);
    const problem = await answerProblem(turn.text, options.projectId);
    if (attempted.get(turn.id) !== turn.text) return;
    if (!problem) {
      // The checker changed or the answer was already fixed: an old failure mark would be a lie.
      if (turn.doctor?.status === "failed") {
        delete turn.doctor;
        options.persist();
      }
      return;
    }
    let candidate = turn.text;
    let diagnosis = problem;
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
        problem,
        ...(diagnosis === problem ? {} : { remaining: diagnosis }),
      });
      try {
        const answer = await repairAnswer({
          answer: candidate,
          error: diagnosis,
          history: answerHistory(options.turns.value),
          selection: options.selection?.value,
          signal: controller.signal,
        });
        if (!alive()) return;
        const extracted = doctorAnswerSource(answer);
        if (!extracted) {
          diagnosis = "Answer Doctor вернул пустой ответ";
          continue;
        }
        candidate = extracted;
        const nextProblem = await answerProblem(candidate, options.projectId);
        if (!alive()) return;
        if (!nextProblem) {
          const current = options.turns.value.find((item) => item.id === turn.id);
          if (current?.text !== turn.text) return;
          replaceAnswer(current, candidate);
          current.doctor = {
            status: "fixed",
            attempts: attempt + 1,
            problem,
            took: Date.now() - startedAt,
            answer: answerFingerprint(candidate),
            at: Date.now(),
          };
          progress.delete(turn.id);
          controllers.delete(turn.id);
          options.persist();
          return;
        }
        diagnosis = nextProblem;
      } catch (error) {
        if (!alive()) return;
        diagnosis = error instanceof Error ? error.message : String(error);
      }
    }
    if (!alive()) return;
    const current = options.turns.value.find((item) => item.id === turn.id);
    if (current?.text === turn.text) {
      current.doctor = {
        status: "failed",
        attempts: ANSWER_DOCTOR_ATTEMPTS,
        problem,
        remaining: diagnosis,
        took: Date.now() - startedAt,
        answer: answerFingerprint(current.text),
        at: Date.now(),
      };
      options.persist();
    }
    progress.set(turn.id, {
      status: "failed",
      attempts: ANSWER_DOCTOR_ATTEMPTS,
      limit: ANSWER_DOCTOR_ATTEMPTS,
      problem,
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
