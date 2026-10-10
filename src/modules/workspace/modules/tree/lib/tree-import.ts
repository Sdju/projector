import type { Ref } from "vue";
import { commandArgs, type useCommandScope } from "../../../../../common/utilities/commands.ts";
import { isFileDrag } from "../../../../path-drop/index.ts";
import {
  checkWorkspaceImport,
  clearWorkspaceImport,
  copyWorkspaceEntries,
  uploadWorkspaceEntry,
  workspaceCanUpload,
  workspaceCapabilities,
  type ImportConflict,
} from "../../../../workspace-api/index.ts";
import { baseName, topLevelName, type DropSource } from "./drop-entries.ts";
import { treeDragType } from "./tree-drag.ts";
import type { TreeContext } from "./tree-operations.ts";

export type ImportChoice =
  | { kind: "replace" }
  | { kind: "keep" }
  | { kind: "prefix"; prefix: string };

/** Что делать с занятыми именами: спросить, отказаться или решить заранее (команда агента). */
export type ConflictMode = "ask" | "fail" | "replace" | "keep" | { prefix: string };
const MODES = ["ask", "fail", "replace", "keep", "prefix"] as const;

export interface ConflictDialogHandle {
  ask(options: {
    directory: string;
    conflicts: ImportConflict[];
    validatePrefix: (prefix: string) => Promise<string>;
  }): Promise<ImportChoice | undefined>;
}

const label = (directory: string) => `«${directory || "корень проекта"}»`;
function plural(count: number) {
  const last = count % 10;
  const teen = count % 100 >= 11 && count % 100 <= 14;
  return `${count} ${!teen && last === 1 ? "запись" : !teen && last >= 2 && last <= 4 ? "записи" : "записей"}`;
}

/**
 * Импорт в дерево: файлы и папки из файлового менеджера (по пути на диске) или из браузера
 * (загрузкой) попадают ровно в выбранную папку; занятые имена не перезаписываются молча.
 */
export function useTreeImport(
  { props, emit, drag }: TreeContext,
  deps: {
    commands: ReturnType<typeof useCommandScope>;
    dialog: Ref<ConflictDialogHandle | undefined>;
    reveal: (path: string) => void;
  },
) {
  const { busy, expanded, error: failure, message } = drag;

  /** Дерево принимает внешний drag, если проект записываемый и умеет получать файлы с диска. */
  function accepts(data: DataTransfer | null) {
    const capabilities = workspaceCapabilities(props.projectId);
    return (
      capabilities.write &&
      capabilities.externalFiles &&
      isFileDrag(data) &&
      !data?.types.includes(treeDragType)
    );
  }

  /** Ошибка префикса для диалога: пустая строка — префикс подходит. */
  async function prefixError(
    projectId: string,
    directory: string,
    conflicts: ImportConflict[],
    all: string[],
    prefix: string,
  ) {
    const renamed = conflicts.map(({ name }) => prefix + name);
    const clash = renamed.find((name) => all.includes(name));
    if (clash) return `«${clash}» совпадёт с другим файлом из этого набора — смените префикс`;
    const { conflicts: taken } = await checkWorkspaceImport(projectId, directory, renamed);
    if (taken.length)
      return `${taken.length === 1 ? `«${taken[0]!.name}» тоже занято` : `Заняты ${taken.map((item) => `«${item.name}»`).join(", ")}`} — смените префикс`;
    return "";
  }

  async function resolveNames(
    projectId: string,
    directory: string,
    names: string[],
    mode: ConflictMode,
  ) {
    const all = [...new Set(names)];
    const { conflicts } = await checkWorkspaceImport(projectId, directory, all);
    const rename = new Map<string, string>();
    if (!conflicts.length) return { rename, clear: [] as string[] };
    let choice: ImportChoice | undefined;
    if (mode === "ask") {
      if (!deps.dialog.value) throw new Error("Диалог конфликтов недоступен");
      choice = await deps.dialog.value.ask({
        directory,
        conflicts,
        validatePrefix: (prefix) => prefixError(projectId, directory, conflicts, all, prefix),
      });
    } else if (mode === "fail")
      throw new Error(
        `В папке ${label(directory)} уже есть: ${conflicts.map(({ name }) => name).join(", ")}`,
      );
    else if (mode === "replace" || mode === "keep") choice = { kind: mode };
    else choice = { kind: "prefix", prefix: mode.prefix };
    if (!choice) return undefined;
    if (choice.kind === "replace") return { rename, clear: conflicts.map(({ name }) => name) };
    if (choice.kind === "keep") {
      for (const { name, free } of conflicts) rename.set(name, free);
      return { rename, clear: [] };
    }
    const error = await prefixError(projectId, directory, conflicts, all, choice.prefix);
    if (error) throw new Error(error);
    for (const { name } of conflicts) rename.set(name, choice.prefix + name);
    return { rename, clear: [] };
  }

  async function transfer(
    projectId: string,
    directory: string,
    source: DropSource,
    mode: ConflictMode,
  ) {
    const upload = source.kind === "files" ? await source.entries : [];
    if (source.kind === "files") {
      if (!upload.length) throw new Error("Не удалось прочитать перетащенные файлы");
      if (!workspaceCanUpload(projectId))
        throw new Error("Этот проект не принимает загрузку файлов");
    }
    const names =
      source.kind === "paths"
        ? source.paths.map(baseName)
        : upload.map((item) => topLevelName(item.path));
    if (names.some((name) => !name)) throw new Error("Не удалось определить имя файла");
    const resolved = await resolveNames(projectId, directory, names, mode);
    if (!resolved) return undefined;
    const target = (name: string) => resolved.rename.get(name) ?? name;
    const join = (name: string) => (directory ? `${directory}/${name}` : name);
    for (const name of resolved.clear)
      if (props.beforeChange && !(await props.beforeChange(join(name))))
        throw new Error("Сначала сохраните изменения открытых файлов");
    if (resolved.clear.length) await clearWorkspaceImport(projectId, directory, resolved.clear);
    if (source.kind === "paths") {
      const entries = source.paths.map((path) => ({ source: path, name: target(baseName(path)) }));
      return (await copyWorkspaceEntries(projectId, directory, entries)).copied;
    }
    const controller = new AbortController();
    drag.progress.value = { done: 0, total: upload.length, cancel: () => controller.abort() };
    try {
      for (const item of upload) {
        const [top, ...rest] = item.path.split("/");
        await uploadWorkspaceEntry(
          projectId,
          directory,
          [target(top!), ...rest].join("/"),
          item.file,
          controller.signal,
        );
        drag.progress.value = { ...drag.progress.value, done: drag.progress.value.done + 1 };
      }
    } catch (error) {
      if (controller.signal.aborted)
        throw new Error(
          `Загрузка отменена: загружено ${drag.progress.value.done} из ${upload.length}`,
        );
      throw error;
    } finally {
      drag.progress.value = undefined;
    }
    return [...new Set(upload.map((item) => join(target(topLevelName(item.path)))))];
  }

  /** Кладёт источник в `directory` и показывает результат; ошибки идут в строку состояния дерева. */
  async function importInto(
    directory: string,
    source: DropSource,
    mode: ConflictMode,
    options: { rethrow?: boolean } = {},
  ) {
    const projectId = props.projectId;
    failure.value = "";
    message.value = "";
    busy.value = true;
    try {
      const copied = await transfer(projectId, directory, source, mode);
      if (projectId !== props.projectId) return copied;
      if (!copied) {
        message.value = "Импорт отменён";
        return copied;
      }
      if (directory) expanded.value.add(directory);
      emit("changed");
      deps.reveal(copied[0]!);
      message.value = `Скопировано в ${label(directory)}: ${plural(copied.length)}`;
      return copied;
    } catch (error) {
      if (projectId === props.projectId) {
        failure.value = error instanceof Error ? error.message : "Не удалось скопировать файлы";
        emit("changed");
      }
      if (options.rethrow) throw error;
    } finally {
      busy.value = false;
    }
  }

  deps.commands.scope.registerCommand({
    id: "ide.fileTree.entry.import",
    title: "Скопировать файлы с диска в папку проекта",
    description:
      "Копирует файлы и папки по абсолютным путям на диске в папку проекта; источник не меняется. Аргументы: paths (массив абсолютных путей), directory (папка проекта относительно корня, по умолчанию корень), conflict — что делать, если имя занято: fail (по умолчанию, ошибка без изменений), replace (старая запись уходит в .projector-trash), keep (новая получает имя «имя (2).ext»), prefix (к занятым именам добавляется prefix), ask (диалог выбора). Возвращает список созданных путей.",
    arguments: {
      paths: "string[] — абсолютные пути файлов и папок на диске",
      directory: "string — папка назначения в проекте, '' — корень",
      conflict: "fail | replace | keep | prefix | ask",
      prefix: "string — префикс для conflict=prefix",
    },
    enabled: () => {
      const capabilities = workspaceCapabilities(props.projectId);
      return capabilities.write && capabilities.externalFiles && !drag.busy.value;
    },
    run: async (value?: unknown) => {
      const args = commandArgs(value);
      if (
        !Array.isArray(args.paths) ||
        !args.paths.length ||
        !args.paths.every((path) => typeof path === "string")
      )
        throw new Error("paths должен быть непустым массивом строк");
      if (args.directory !== undefined && typeof args.directory !== "string")
        throw new Error("directory должен быть строкой");
      const conflict = args.conflict ?? "fail";
      if (!MODES.includes(conflict as (typeof MODES)[number]))
        throw new Error("conflict должен быть fail, replace, keep, prefix или ask");
      if (conflict === "prefix" && (typeof args.prefix !== "string" || !args.prefix))
        throw new Error("Для conflict=prefix укажите prefix");
      const copied = await importInto(
        (args.directory as string | undefined) ?? "",
        { kind: "paths", paths: args.paths as string[] },
        conflict === "prefix" ? { prefix: args.prefix as string } : (conflict as ConflictMode),
        { rethrow: true },
      );
      return { copied: copied ?? [] };
    },
  });

  return { accepts, importInto };
}
