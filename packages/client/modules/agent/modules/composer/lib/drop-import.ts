import {
  checkWorkspaceImport,
  uploadWorkspaceEntry,
  workspaceCanUpload,
} from "../../../../workspace-api/index.ts";
import { topLevelName, type DroppedEntry } from "../../../../path-drop/index.ts";
import type { MessageChip } from "../../../../agent-core/index.ts";

/**
 * Кладёт файлы и папки из файлового менеджера в корень проекта, не заменяя занятые имена,
 * и возвращает чипы верхнего уровня: агент читает их как обычные `@path`.
 */
export async function importDroppedEntries(
  projectId: string,
  entries: DroppedEntry[],
): Promise<MessageChip[]> {
  if (!entries.length) throw new Error("Не удалось прочитать перетащенные файлы");
  if (!workspaceCanUpload(projectId)) throw new Error("Этот проект не принимает загрузку файлов");
  const tops = [...new Set(entries.map((entry) => topLevelName(entry.path)))];
  const { conflicts } = await checkWorkspaceImport(projectId, "", tops);
  const renamed = new Map(conflicts.map(({ name, free }) => [name, free]));
  const nameOf = (top: string) => renamed.get(top) ?? top;
  for (const entry of entries) {
    const [top, ...rest] = entry.path.split("/");
    await uploadWorkspaceEntry(projectId, "", [nameOf(top!), ...rest].join("/"), entry.file);
  }
  return tops.map((top) => {
    const path = nameOf(top);
    const own = entries.find((entry) => entry.path === top);
    return own?.file
      ? ({ type: "file", path } as const)
      : ({ type: "file", path, directory: true } as const);
  });
}
