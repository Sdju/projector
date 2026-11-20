import { workspaceRequest } from "../../../../workspace-api/index.ts";
import { useFileDiffs } from "./file-diffs.ts";

/** Раскрытые файлы merge request: стороны читаются при первом раскрытии и кешируются до смены head. */
export function usePullDiffs(
  projectId: () => string,
  number: () => number,
  head: () => string,
  base: () => string,
) {
  return useFileDiffs({
    read: (path) =>
      workspaceRequest(projectId(), "pull-diff", {
        number: String(number()),
        path,
        head: head(),
        base: base(),
      }),
    errorFallback: "Не удалось прочитать изменения",
    // A new push changes base/head: cached sides must not survive it.
    resetOn: () => `${head()}:${base()}`,
  });
}
