import type { PullRequestComparison } from "@projector-ai/core/modules/workspace/index.ts";
import { useFileDiffs } from "./file-diffs.ts";

/** Раскрытые файлы merge request: стороны читаются при первом раскрытии и кешируются до смены head. */
export function usePullDiffs(projectId: () => string, number: () => number, head: () => string) {
  return useFileDiffs<PullRequestComparison>({
    projectId,
    action: "pull-diff",
    params: () => ({ number: String(number()) }),
    errorFallback: "Не удалось прочитать изменения",
    // A new push changes base/head: cached sides must not survive it.
    resetOn: head,
  });
}
