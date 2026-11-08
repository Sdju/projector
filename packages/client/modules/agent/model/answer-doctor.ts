import { onScopeDispose, watch, type Ref } from "vue";
import { answerProblem, doctorAnswerSource } from "../../widget-runtime/index.ts";
import { repairAnswer } from "../api/client.ts";
import type { AgentPart, AgentSelection, AgentTurn } from "./types.ts";

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

  async function prepare(turn: AgentTurn): Promise<void> {
    if (turn.role !== "assistant" || attempted.get(turn.id) === turn.text) return;
    attempted.set(turn.id, turn.text);
    controllers.get(turn.id)?.abort();
    const problem = await answerProblem(turn.text, options.projectId);
    if (!problem || attempted.get(turn.id) !== turn.text) return;
    let candidate = turn.text;
    let diagnosis = problem;
    const controller = new AbortController();
    controllers.set(turn.id, controller);
    for (
      let attempt = 0;
      attempt < ANSWER_DOCTOR_ATTEMPTS && !controller.signal.aborted;
      attempt++
    ) {
      try {
        const answer = await repairAnswer({
          answer: candidate,
          error: diagnosis,
          history: answerHistory(options.turns.value),
          selection: options.selection?.value,
          signal: controller.signal,
        });
        if (controller.signal.aborted || attempted.get(turn.id) !== turn.text) return;
        const extracted = doctorAnswerSource(answer);
        if (!extracted) {
          diagnosis = "Answer Doctor вернул пустой ответ";
          continue;
        }
        candidate = extracted;
        const nextProblem = await answerProblem(candidate, options.projectId);
        if (controller.signal.aborted || attempted.get(turn.id) !== turn.text) return;
        if (!nextProblem) {
          const current = options.turns.value.find((item) => item.id === turn.id);
          if (current?.text !== turn.text) return;
          replaceAnswer(current, candidate);
          options.persist();
          return;
        }
        diagnosis = nextProblem;
      } catch (error) {
        if (controller.signal.aborted || attempted.get(turn.id) !== turn.text) return;
        diagnosis = error instanceof Error ? error.message : String(error);
      }
    }
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
  });
}
