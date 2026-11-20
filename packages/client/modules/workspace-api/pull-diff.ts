import type { PullRequestComparison } from "@ai-projector/core/modules/workspace/index.ts";
import type { WorkspaceParams } from "./actions.ts";

/** Reject a response from a provider that cannot supply the requested version. */
export function verifyPullDiff({ head, base }: WorkspaceParams, result: unknown): void {
  const diff = result as PullRequestComparison | null | undefined;
  if ((head && diff?.hash !== head) || (base && diff?.baseSha !== base))
    throw new Error("Эта версия diff merge request недоступна. Обновите карточку MR");
}
