import { isStepCount, type StopCondition } from "ai";

/** Steps one turn may take; `PROJECTOR_AGENT_MAX_STEPS` raises or lowers it. */
export const MAX_STEPS = Number(process.env.PROJECTOR_AGENT_MAX_STEPS) || 24;
/** The same call with the same result this many times in a row is a loop, not progress. */
export const LOOP_REPEATS = 3;

interface StepLike {
  toolCalls?: Array<{ toolName: string; input?: unknown }>;
  toolResults?: Array<{ output?: unknown }>;
}

/** What a step did, as one comparable string; empty when it called no tools. */
function fingerprint(step: StepLike): string {
  const calls = step.toolCalls ?? [];
  if (!calls.length) return "";
  return JSON.stringify([
    calls.map((call) => [call.toolName, call.input]),
    (step.toolResults ?? []).map((result) => result.output),
  ]);
}

/** True when the last steps repeat one another exactly. */
export function isLooping(steps: StepLike[], repeats = LOOP_REPEATS): boolean {
  if (steps.length < repeats) return false;
  const last = fingerprint(steps[steps.length - 1]!);
  if (!last) return false;
  return steps.slice(-repeats).every((step) => fingerprint(step) === last);
}

/** Stop conditions of a turn; `reason()` says which one ended it. */
export function turnBudget() {
  let stopped: "loop" | undefined;
  const looping: StopCondition<any, any> = ({ steps }) => {
    if (!isLooping(steps)) return false;
    stopped = "loop";
    return true;
  };
  return {
    stopWhen: [isStepCount(MAX_STEPS), looping],
    reason: () => stopped,
  };
}

/** The line that tells the user why the turn ended on tool calls. */
export function budgetNote(reason: "loop" | undefined): string {
  return reason === "loop"
    ? "\n\nЯ остановился: последние вызовы повторяются с тем же результатом. Подскажите, как действовать дальше."
    : `\n\nЯ остановился на ${MAX_STEPS} шагах. Напишите «продолжай», чтобы я пошёл дальше.`;
}
