import type { StopCondition } from "ai";

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

export type StopReason = "steps" | "loop" | "tokens" | "time";

/** Seconds one turn may run; `PROJECTOR_AGENT_MAX_SECONDS`, 0 lifts the limit. */
export const MAX_SECONDS = Number(process.env.PROJECTOR_AGENT_MAX_SECONDS ?? 900);
/** Tokens (prompt and answer of all steps) one turn may spend; `PROJECTOR_AGENT_MAX_TOKENS`, 0 is no limit. */
export const MAX_TOKENS = Number(process.env.PROJECTOR_AGENT_MAX_TOKENS ?? 0);

interface UsedStep extends StepLike {
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Tokens all steps took together. */
export function tokensSpent(steps: UsedStep[]): number {
  return steps.reduce(
    (sum, step) => sum + (step.usage?.inputTokens ?? 0) + (step.usage?.outputTokens ?? 0),
    0,
  );
}

/** Stop conditions of a turn; `reason()` says which one ended it. */
export function turnBudget(
  limits: { seconds?: number; tokens?: number; steps?: number } = {},
  now = Date.now,
) {
  const seconds = limits.seconds ?? MAX_SECONDS;
  const tokens = limits.tokens ?? MAX_TOKENS;
  const steps = limits.steps ?? MAX_STEPS;
  const started = now();
  let stopped: StopReason | undefined;
  const stopBy =
    (reason: StopReason, over: (steps: UsedStep[]) => boolean): StopCondition<any, any> =>
    ({ steps }) => {
      if (!over(steps)) return false;
      stopped = reason;
      return true;
    };
  return {
    stopWhen: [
      stopBy("steps", (used) => used.length >= steps),
      stopBy("loop", (steps) => isLooping(steps)),
      stopBy("time", () => seconds > 0 && now() - started >= seconds * 1000),
      stopBy("tokens", (used) => tokens > 0 && tokensSpent(used) >= tokens),
    ],
    reason: () => stopped,
  };
}

/** The line that tells the user why the turn ended on tool calls. */
export function budgetNote(
  reason: StopReason | undefined,
  limits: { seconds?: number; tokens?: number; steps?: number } = {},
): string {
  const seconds = limits.seconds ?? MAX_SECONDS;
  const tokens = limits.tokens ?? MAX_TOKENS;
  const steps = limits.steps ?? MAX_STEPS;
  switch (reason) {
    case "loop":
      return "\n\nЯ остановился: последние вызовы повторяются с тем же результатом. Подскажите, как действовать дальше.";
    case "time":
      return `\n\nЯ остановился: ход идёт дольше ${seconds} с.`;
    case "tokens":
      return `\n\nЯ остановился: ход израсходовал ${tokens} токенов.`;
    default:
      return `\n\nЯ остановился на ${steps} шагах.`;
  }
}
