import type { Ref } from "vue";
import type { CommandScope } from "../../../../../common/utilities/commands.ts";
import { isLiveScope } from "@projector/core/modules/workspace/index.ts";
import type { FileEntry, FileScope } from "@projector/core/modules/workspace/index.ts";
import { revealWorkspaceEntry, workspaceCapabilities } from "../../../../workspace-api/index.ts";

/**
 * Registers «Показать в проводнике». Only a live local source has a file manager to show
 * entries in; snapshots and remote sources hide the command.
 */
export function registerTreeReveal(
  commands: CommandScope,
  source: { projectId: string; scope: FileScope },
  state: { busy: Ref<boolean>; error: Ref<string> },
  resolveEntry: (value?: unknown) => FileEntry | undefined,
) {
  const capabilities = workspaceCapabilities(source.projectId);
  const available = () => capabilities.reveal && isLiveScope(source.scope) && !state.busy.value;
  async function reveal(value?: unknown) {
    try {
      return await revealWorkspaceEntry(source.projectId, resolveEntry(value)?.path ?? "");
    } catch (error) {
      state.error.value =
        error instanceof Error ? error.message : "Не удалось показать в проводнике";
      throw error;
    }
  }
  commands.registerCommand({
    id: "ide.fileTree.entry.reveal",
    title: "Показать в проводнике",
    description:
      "Открывает файл или папку выделенными в системном файловом менеджере. Доступно только для локального проекта на компьютере с сервером Projector.",
    arguments: {
      path: "Путь записи внутри проекта; пустая строка — корень проекта; без аргумента — запись из контекстного меню",
    },
    run: reveal,
    enabled: available,
  });
  return available;
}
