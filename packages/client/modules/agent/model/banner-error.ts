import type { AgentTurn } from "../../agent-core/index.ts";

/**
 * What the composer banner above the input says. The failed last answer already shows the same
 * reason and its own retry in the chat log, so the banner stays silent instead of repeating the
 * failure. A copy error is not part of that answer and still wins.
 */
export function bannerErrorOf(
  error: string,
  copyError: string,
  turns: readonly AgentTurn[],
): string {
  const last = turns.at(-1);
  if (last?.role === "assistant" && last.failure === error) return copyError;
  return error || copyError;
}
