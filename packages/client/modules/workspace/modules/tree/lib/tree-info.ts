import type { Ref } from "vue";
import type { CommandScope } from "../../../../../common/utilities/commands.ts";
import {
  isLiveScope,
  type FileEntry,
  type FileScope,
} from "@ai-projector/core/modules/workspace/index.ts";
import type { WorkspaceCapabilities } from "../../../../workspace-api/index.ts";

/**
 * Registers «Информация…». Size and counts come from the local filesystem, so the command is
 * hidden for snapshots and sources that cannot report real file stats.
 */
export function registerTreeInfo(
  commands: CommandScope,
  source: { projectId: string; scope: FileScope },
  state: { busy: Ref<boolean> },
  open: (entry: FileEntry) => unknown,
  resolveEntry: (value?: unknown) => FileEntry | undefined,
  capabilities: Readonly<WorkspaceCapabilities>,
) {
  const available = () => capabilities.entryInfo && isLiveScope(source.scope) && !state.busy.value;
  commands.registerCommand({
    id: "ide.fileTree.entry.info",
    title: "Информация…",
    description:
      "Открывает вкладку с размером, числом файлов и папок, символическими ссылками и датой последнего изменения записи. Содержимое папки считается рекурсивно, без перехода по символическим ссылкам; большая папка может считаться дольше. Доступно для локального проекта и только для его текущих файлов.",
    arguments: {
      path: "Путь файла или папки внутри проекта; пустая строка или отсутствие аргумента — корень проекта или запись из контекстного меню",
      kind: "directory или file: подсказка для пути, открытого не из дерева",
    },
    run: (args) => {
      const entry = resolveEntry(args);
      if (entry) return open(entry);
    },
    enabled: (args) => available() && !!resolveEntry(args),
  });
  return available;
}
