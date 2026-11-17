import { isAgentFailure } from "@ai-projector/core/modules/agent-failure/index.ts";
import type { AgentTurn } from "./types.ts";

/**
 * The answer a quota continuation belongs to: the last one, failed on a usage limit, with a reset
 * still ahead. A passed reset is not a plan any more; the ordinary retry is the honest action.
 */
export function quotaResumeTurn(
  turns: readonly AgentTurn[],
  now = Date.now(),
): AgentTurn | undefined {
  const last = turns.at(-1);
  if (!last || last.role !== "assistant") return;
  const failure = last.failureInfo;
  if (!isAgentFailure(failure) || failure.class !== "usage_limit") return;
  if (failure.resetAt === undefined || failure.resetAt <= now) return;
  return last;
}
