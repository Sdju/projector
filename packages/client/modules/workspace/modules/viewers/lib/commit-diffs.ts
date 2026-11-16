import { workspaceRequest } from "../../../../workspace-api/index.ts";
import { useFileDiffs } from "./file-diffs.ts";

/** Раскрытые файлы коммита: код читается при первом раскрытии и кэшируется до смены коммита. */
export function useCommitDiffs(projectId: () => string, hash: () => string) {
  return useFileDiffs({
    read: (path) => workspaceRequest(projectId(), "commit-diff", { hash: hash(), path }),
    errorFallback: "Ошибка Git",
  });
}
