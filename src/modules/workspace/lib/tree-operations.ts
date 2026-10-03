import { computed, nextTick, useId, type Ref } from "vue";
import { useCommandScope, commandArgs } from "../../../common/utilities/commands.ts";
import type ContextMenu from "../../../common/ui/ContextMenu.vue";
import type EntryDialog from "../../../common/ui/EntryDialog.vue";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { workspaceRequest, moveWorkspaceEntry, mutateWorkspaceEntry } from "../api.ts";
import type { createTreeDrag } from "../tree-drag.ts";
import { topLevelTreePaths, type createTreeSelection } from "../tree-selection.ts";
import { parentPath, relocatedPath } from "../../../../core/modules/workspace/index.ts";
import type { FileEntry } from "../../../../core/modules/workspace/index.ts";
import { ref } from "vue";

export interface TreeEmit {
  (event: "open", path: string): void;
  (event: "moved", source: string, destination: string): void;
  (event: "changed"): void;
  (event: "deleted", path: string): void;
}
export interface TreeContext {
  props: { projectId: string; path: string; beforeChange?: (path: string) => Promise<boolean> };
  emit: TreeEmit;
  selection: ReturnType<typeof createTreeSelection>;
  drag: ReturnType<typeof createTreeDrag>;
  tree: Ref<HTMLElement | undefined>;
  menu: Ref<InstanceType<typeof ContextMenu> | undefined>;
  dialog: Ref<InstanceType<typeof EntryDialog> | undefined>;
  toggle: (path: string) => void;
}

/** Операции корневого дерева: создание, переименование, буфер обмена, удаление и их команды. */
export function useTreeOperations({
  props,
  emit,
  selection,
  drag,
  tree,
  menu,
  dialog,
  toggle,
}: TreeContext) {
  const { busy, expanded, error: moveError, message } = drag;
  const contextEntry = ref<FileEntry>();
  const clipboard = ref<{ paths: string[]; cut: boolean }>();
  const operation = ref<{
    action: string;
    path: string;
    directory: string;
    projectId: string;
    paths?: string[];
  }>();
  const treeCommands = useCommandScope(`fileTree:${useId()}`, () => ({
    surface: "fileTree",
    projectId: props.projectId,
    entryKind: contextEntry.value ? (contextEntry.value.directory ? "directory" : "file") : "root",
    busy: drag.busy.value,
    clipboard: !!clipboard.value,
  }));
  function resolveEntry(value?: unknown): FileEntry | undefined {
    const args = commandArgs(value);
    if (args.path === undefined) return contextEntry.value;
    if (typeof args.path !== "string") throw new Error("path должен быть строкой");
    if (!args.path) return undefined;
    return {
      path: args.path,
      name: args.path.split("/").at(-1)!,
      directory: args.kind === "directory",
    };
  }
  function actionPaths(value?: unknown) {
    if (commandArgs(value).path !== undefined) {
      const entry = resolveEntry(value);
      return entry ? [entry.path] : [];
    }
    return topLevelTreePaths(selection.paths.value);
  }
  async function requestAction(action: string, initial = "", value?: unknown) {
    const args = commandArgs(value);
    const entry = resolveEntry(value);
    if (args.directory !== undefined && typeof args.directory !== "string")
      throw new Error("directory должен быть строкой");
    const directory =
      typeof args.directory === "string"
        ? args.directory
        : entry?.directory
          ? entry.path
          : parentPath(entry?.path ?? "");
    const op = {
      action,
      path: entry?.path ?? "",
      directory,
      projectId: props.projectId,
      paths: action === "delete" ? actionPaths(value) : undefined,
    };
    if (args.name !== undefined && typeof args.name !== "string")
      throw new Error("name должен быть строкой");
    if (args.confirm !== undefined && typeof args.confirm !== "boolean")
      throw new Error("confirm должен быть boolean");
    if (
      (action !== "delete" && typeof args.name === "string") ||
      (action === "delete" && args.confirm === true)
    )
      return runOperation(typeof args.name === "string" ? args.name : "", op, false);
    operation.value = op;
    const titles: Record<string, string> = {
      "create-file": "Новый файл",
      "create-directory": "Новая папка",
      rename: "Переименовать",
      copy: "Дублировать",
      delete: "Удалить запись?",
    };
    void nextTick(() =>
      dialog.value?.open({
        title: titles[action]!,
        value: initial,
        confirm: action === "delete",
        description:
          action === "delete"
            ? `${op.paths?.join(", ")}. Записи будут перемещены в .projector-trash в корне проекта.`
            : undefined,
      }),
    );
  }
  async function runOperation(name: string, op = operation.value, interactive = true) {
    if (!op) return;
    busy.value = true;
    moveError.value = "";
    message.value = "";
    try {
      const paths = op.paths ?? [op.path];
      if (["rename", "delete"].includes(op.action) && props.beforeChange)
        for (const path of paths)
          if (!(await props.beforeChange(path)))
            throw new Error("Сначала сохраните изменения открытых файлов");
      let result: Awaited<ReturnType<typeof mutateWorkspaceEntry>> = {};
      for (const path of paths) {
        result = await mutateWorkspaceEntry(
          op.projectId,
          op.action,
          path,
          op.action === "copy" ? parentPath(path) : op.directory,
          name,
        );
        if (op.projectId !== props.projectId) return;
        if (op.action === "delete") {
          selection.relocate(path);
          expanded.value = new Set(
            [...expanded.value].filter((p) => p !== path && !p.startsWith(path + "/")),
          );
          if (clipboard.value) {
            clipboard.value.paths = clipboard.value.paths.filter(
              (p) => p !== path && !p.startsWith(path + "/"),
            );
            if (!clipboard.value.paths.length) clipboard.value = undefined;
          }
          if (op.paths) op.paths = op.paths.filter((pending) => pending !== path);
          emit("deleted", path);
        }
      }
      if (interactive) dialog.value?.close();
      if (op.projectId !== props.projectId) return;
      if (op.action === "rename") {
        expanded.value = new Set(
          [...expanded.value].map((path) => relocatedPath(path, op.path, result.destination!)),
        );
        selection.relocate(op.path, result.destination!);
        if (clipboard.value)
          clipboard.value.paths = clipboard.value.paths.map((path) =>
            relocatedPath(path, op.path, result.destination!),
          );
        emit("moved", op.path, result.destination!);
      } else if (op.action !== "delete") {
        if (op.directory) expanded.value.add(op.directory);
        emit("changed");
        if (op.action === "create-file") emit("open", result.destination!);
      }
      message.value = "Готово";
      return result;
    } catch (error) {
      if (!interactive) throw error;
      dialog.value?.fail(error instanceof Error ? error.message : "Не удалось выполнить действие");
    } finally {
      busy.value = false;
    }
  }
  async function paste(value?: unknown) {
    const args = commandArgs(value);
    if (args.directory !== undefined && typeof args.directory !== "string")
      throw new Error("directory должен быть строкой");
    const clip = clipboard.value;
    if (!clip) return;
    const directory =
      typeof args.directory === "string"
        ? args.directory
        : contextEntry.value?.directory
          ? contextEntry.value.path
          : parentPath(contextEntry.value?.path ?? "");
    busy.value = true;
    moveError.value = "";
    const projectId = props.projectId;
    try {
      if (clip.cut && props.beforeChange)
        for (const path of clip.paths)
          if (!(await props.beforeChange(path)))
            throw new Error("Сначала сохраните изменения открытых файлов");
      let result;
      for (const path of [...clip.paths]) {
        result = clip.cut
          ? await moveWorkspaceEntry(projectId, path, directory)
          : await mutateWorkspaceEntry(projectId, "copy", path, directory, path.split("/").at(-1)!);
        if (projectId !== props.projectId) return;
        if (directory) expanded.value.add(directory);
        if (clip.cut) {
          expanded.value = new Set(
            [...expanded.value].map((p) => relocatedPath(p, path, result!.destination!)),
          );
          selection.relocate(path, result.destination!);
          clip.paths = clip.paths.filter((p) => p !== path);
          if (!clip.paths.length) clipboard.value = undefined;
          emit("moved", path, result.destination!);
        } else emit("changed");
      }
      message.value = "Готово";
      return result;
    } catch (error) {
      moveError.value = error instanceof Error ? error.message : "Не удалось вставить";
      throw error;
    } finally {
      busy.value = false;
    }
  }
  async function copyPath(relative: boolean, value?: unknown) {
    try {
      const paths = actionPaths(value);
      if (!paths.length) paths.push("");
      if (relative)
        await navigator.clipboard.writeText(paths.map((path) => path || ".").join("\n"));
      else {
        const data = await workspaceRequest<{ root: string }>(props.projectId, "root");
        await navigator.clipboard.writeText(
          paths.map((path) => data.root + (path ? "/" + path : "")).join("\n"),
        );
      }
    } catch (error) {
      moveError.value = "Не удалось скопировать путь в буфер обмена";
      throw error;
    }
  }
  const register = (
    id: string,
    title: string,
    run: (args?: unknown) => unknown,
    enabled: (args?: unknown) => boolean = () => true,
  ) =>
    treeCommands.scope.registerCommand({
      id: `ide.fileTree.${id}`,
      title,
      run,
      enabled: (args) => !drag.busy.value && enabled(args),
    });
  const hasEntry = (args?: unknown) => !!resolveEntry(args) && actionPaths(args).length > 0;
  const singleEntry = (args?: unknown) =>
    hasEntry(args) &&
    actionPaths(args).length === 1 &&
    (commandArgs(args).path !== undefined || selection.paths.value.size <= 1);
  register(
    "file.open",
    "Открыть",
    (args) => emit("open", resolveEntry(args)!.path),
    (args) => !!resolveEntry(args) && !resolveEntry(args)!.directory,
  );
  register("file.create", "Новый файл…", (args) => requestAction("create-file", "", args));
  register("directory.create", "Новая папка…", (args) =>
    requestAction("create-directory", "", args),
  );
  for (const kind of ["file", "directory"])
    register(
      `${kind}.rename`,
      "Переименовать…",
      (args) => requestAction("rename", resolveEntry(args)!.name, args),
      singleEntry,
    );
  register(
    "entry.cut",
    "Вырезать",
    (args) => {
      clipboard.value = { paths: actionPaths(args), cut: true };
    },
    hasEntry,
  );
  register(
    "entry.copy",
    "Копировать",
    (args) => {
      clipboard.value = { paths: actionPaths(args), cut: false };
    },
    hasEntry,
  );
  register(
    "entry.duplicate",
    "Дублировать…",
    (args) =>
      requestAction("copy", resolveEntry(args)!.name.replace(/(\.[^.]*)?$/, " copy$1"), args),
    singleEntry,
  );
  register("entry.paste", "Вставить", paste, () => !!clipboard.value);
  register("entry.copyRelativePath", "Копировать относительный путь", (args) =>
    copyPath(true, args),
  );
  register("entry.copyPath", "Копировать полный путь", (args) => copyPath(false, args));
  register(
    "directory.toggle",
    "Развернуть / свернуть папку",
    (args) => toggle(resolveEntry(args)!.path),
    (args) => !!resolveEntry(args)?.directory,
  );
  register("collapseAll", "Свернуть все папки", () => expanded.value.clear());
  register("refresh", "Обновить", () => emit("changed"));
  register("entry.delete", "Удалить…", (args) => requestAction("delete", "", args), hasEntry);
  register("contextMenu", "Открыть меню", () => {
    const target = tree.value?.querySelector<HTMLElement>(
      contextEntry.value
        ? `button[data-path="${CSS.escape(contextEntry.value.path)}"]`
        : ".root-label",
    );
    if (!target) return;
    return menu.value?.openForElement(target);
  });
  const menuItems = computed<ContextMenuItem[]>(() => {
    const entry = contextEntry.value;
    const item = (
      id: string,
      options: { separator?: boolean; danger?: boolean; label?: string } = {},
    ) => treeCommands.item(`ide.fileTree.${id}`, undefined, options);
    const items: ContextMenuItem[] = [];
    if (entry && !entry.directory) items.push(item("file.open"));
    if (!entry || entry.directory) items.push(item("file.create"), item("directory.create"));
    if (entry)
      items.push(
        item(`${entry.directory ? "directory" : "file"}.rename`, { separator: true }),
        item("entry.cut"),
        item("entry.copy"),
        item("entry.duplicate"),
      );
    items.push(
      item("entry.paste"),
      item("entry.copyRelativePath", { separator: true }),
      item("entry.copyPath"),
    );
    if (entry?.directory)
      items.push(
        item("directory.toggle", {
          label: expanded.value.has(entry.path) ? "Свернуть папку" : "Развернуть папку",
        }),
      );
    if (!entry) items.push(item("collapseAll"));
    items.push(item("refresh"));
    if (entry) items.push(item("entry.delete", { danger: true, separator: true }));
    return items;
  });
  return { contextEntry, clipboard, treeCommands, menuItems, runOperation };
}
