import type { CommitComparison } from "@projector/core/modules/workspace/index.ts";
import { useFileDiffs } from "./file-diffs.ts";

/** Раскрытые файлы коммита: код читается при первом раскрытии и кэшируется до смены коммита. */
export function useCommitDiffs(projectId: () => string, hash: () => string) {
  return useFileDiffs<CommitComparison>({
    projectId,
    action: "commit-diff",
    params: () => ({ hash: hash() }),
    errorFallback: "Ошибка Git",
  });
}
