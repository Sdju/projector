<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  provide,
  ref,
  useId,
  watch,
  type ComputedRef,
} from "vue";
import { useSessionSnapshot, treeSessionSchema } from "../session.ts";
import { useCommandScope, commandArgs } from "../../../common/utilities/commands.ts";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import EntryDialog from "../../../common/ui/EntryDialog.vue";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import IconChevronRight from "~icons/lucide/chevron-right";
import { FileIcon } from "../../file-icons/index.ts";
import { useFileIconTheme } from "../../file-icons/index.ts";
import { workspaceRequest, moveWorkspaceEntry, mutateWorkspaceEntry } from "../api.ts";
import { createTreeDrag, treeDragKey, treeDragType } from "../tree-drag.ts";
import {
  createTreeSelection,
  treeSelectionKey,
  selectTreeRange,
  topLevelTreePaths,
} from "../tree-selection.ts";
import {
  gitTreeDecorations,
  type GitDecoration,
  type GitOverview,
  moveDestination,
  parentPath,
  relocatedPath,
} from "../../../../core/modules/workspace/index.ts";
import type { FileEntry } from "../../../../core/modules/workspace/index.ts";
const props = withDefaults(
  defineProps<{
    projectId: string;
    path?: string;
    selected: string;
    depth?: number;
    revision: number;
    gitChanges?: GitOverview["changes"];
    beforeChange?: (path: string) => Promise<boolean>;
  }>(),
  { path: "", depth: 0 },
);
const emit = defineEmits<{
  open: [path: string];
  moved: [source: string, destination: string];
  changed: [];
  deleted: [path: string];
}>();
const entries = ref<FileEntry[]>([]);
const gitDecorations =
  props.depth === 0
    ? computed(() => gitTreeDecorations(props.gitChanges ?? []))
    : inject<ComputedRef<Map<string, GitDecoration>>>("workspace-tree-git")!;
if (props.depth === 0) provide("workspace-tree-git", gitDecorations);
const gitLabels: Record<GitDecoration, string> = {
  added: "Новые записи Git",
  modified: "Есть изменения Git",
  deleted: "Удалённые записи Git",
  conflict: "Конфликт Git",
};
const drag = props.depth === 0 ? createTreeDrag() : inject(treeDragKey)!;
if (props.depth === 0) provide(treeDragKey, drag);
const selection = props.depth === 0 ? createTreeSelection() : inject(treeSelectionKey)!;
if (props.depth === 0) provide(treeSelectionKey, selection);
const menu = ref<InstanceType<typeof ContextMenu>>();
const dialog = ref<InstanceType<typeof EntryDialog>>();
const contextEntry = ref<FileEntry>();
const clipboard = ref<{ paths: string[]; cut: boolean }>();
const operation = ref<{
  action: string;
  path: string;
  directory: string;
  projectId: string;
  paths?: string[];
}>();
type OpenContext = (event: MouseEvent | KeyboardEvent, entry?: FileEntry) => void;
const showContext: OpenContext =
  props.depth === 0
    ? (event, entry) => {
        if (drag.busy.value) {
          event.preventDefault();
          return;
        }
        if (entry && !selection.paths.value.has(entry.path)) selection.replace(entry.path);
        if (!entry) selection.replace();
        contextEntry.value = entry;
        treeCommands.scope.activate();
        void menu.value?.open(event);
      }
    : inject<OpenContext>("workspace-context")!;
if (props.depth === 0) provide("workspace-context", showContext);
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
    if (relative) await navigator.clipboard.writeText(paths.map((path) => path || ".").join("\n"));
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
const localCommands =
  props.depth === 0
    ? useCommandScope(`fileTree:${useId()}`, () => ({
        surface: "fileTree",
        projectId: props.projectId,
        entryKind: contextEntry.value
          ? contextEntry.value.directory
            ? "directory"
            : "file"
          : "root",
        busy: drag.busy.value,
        clipboard: !!clipboard.value,
      }))
    : undefined;
const treeCommands =
  localCommands ?? inject<NonNullable<typeof localCommands>>("workspace-tree-commands")!;
if (props.depth === 0) {
  provide("workspace-tree-commands", treeCommands);
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
}
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
function visibleRows() {
  return [...(tree.value?.querySelectorAll<HTMLButtonElement>("button[data-path]") ?? [])];
}
function selectEntry(event: MouseEvent | KeyboardEvent, entry: FileEntry) {
  const result = selectTreeRange(
    selection.paths.value,
    selection.anchor.value,
    entry.path,
    visibleRows().map((row) => row.dataset.path!),
    event,
  );
  selection.paths.value = result.paths;
  selection.anchor.value = result.anchor;
}
function clickEntry(event: MouseEvent, entry: FileEntry) {
  if (props.depth !== 0) {
    injectClickEntry!(event, entry);
    return;
  }
  if (busy.value) return;
  activateEntry(entry);
  selectEntry(event, entry);
  if (event.shiftKey || event.ctrlKey || event.metaKey) return;
  treeCommands.run(entry.directory ? "ide.fileTree.directory.toggle" : "ide.fileTree.file.open");
}
const injectClickEntry = props.depth
  ? inject<(event: MouseEvent, entry: FileEntry) => void>("workspace-entry-click")
  : undefined;
if (props.depth === 0) provide("workspace-entry-click", clickEntry);
function entryKey(event: KeyboardEvent, entry?: FileEntry) {
  if (props.depth !== 0) {
    injectEntryKey?.(event, entry);
    return;
  }
  contextEntry.value = entry;
  treeCommands.scope.activate();
  if (busy.value) {
    event.preventDefault();
    return;
  }
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === "a") {
    event.preventDefault();
    const rows = visibleRows();
    selection.paths.value = new Set(rows.map((row) => row.dataset.path!));
    if (!selection.anchor.value)
      selection.anchor.value = entry?.path ?? rows[0]?.dataset.path ?? "";
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    selection.replace();
    return;
  }
  if (
    entry &&
    ["ArrowUp", "ArrowDown", "Home", "End", "ArrowLeft", "ArrowRight", " "].includes(event.key)
  ) {
    event.preventDefault();
    if (event.key === " ") {
      selectEntry(event, entry);
      return;
    }
    const rows = visibleRows();
    const index = rows.findIndex((row) => row.dataset.path === entry.path);
    let next = index;
    if (event.key === "ArrowDown") next = Math.min(rows.length - 1, index + 1);
    if (event.key === "ArrowUp") next = Math.max(0, index - 1);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = rows.length - 1;
    if (event.key === "ArrowRight") {
      if (!entry.directory) return;
      if (!expanded.value.has(entry.path)) {
        toggle(entry.path);
        return;
      }
      if (rows[index + 1]?.dataset.path?.startsWith(entry.path + "/")) next = index + 1;
    }
    if (event.key === "ArrowLeft") {
      if (entry.directory && expanded.value.has(entry.path)) {
        toggle(entry.path);
        return;
      }
      next = rows.findIndex((row) => row.dataset.path === parentPath(entry.path));
    }
    const row = rows[next];
    if (row) {
      if (!mod || event.shiftKey)
        selectEntry(event, {
          path: row.dataset.path!,
          name: "",
          directory: row.getAttribute("aria-expanded") !== null,
        });
      row.focus();
      row.scrollIntoView({ block: "nearest" });
    }
    return;
  }
  treeCommands.keydown(event);
}
function activateEntry(entry?: FileEntry) {
  if (props.depth !== 0) {
    injectActivateEntry?.(entry);
    return;
  }
  contextEntry.value = entry;
  treeCommands.scope.activate();
}
const injectEntryKey = props.depth
  ? inject<(event: KeyboardEvent, entry?: FileEntry) => void>("workspace-entry-key")
  : undefined;
const injectActivateEntry = props.depth
  ? inject<(entry?: FileEntry) => void>("workspace-entry-focus")
  : undefined;
if (props.depth === 0) {
  provide("workspace-entry-key", entryKey);
  provide("workspace-entry-focus", activateEntry);
}
const { source, target, busy, expanded, error: moveError, message } = drag;
if (props.depth === 0) {
  const session = useSessionSnapshot(
    () => `projector:tree:v1:${props.projectId}`,
    () => [...expanded.value],
    treeSessionSchema,
  );
  expanded.value = new Set(session.read() ?? []);
  watch(
    () => props.projectId,
    () => {
      menu.value?.close(false);
      dialog.value?.close();
      clipboard.value = undefined;
      selection.replace();
      selection.dragged.value = [];
      drag.clear();
      expanded.value = new Set(session.read() ?? []);
      moveError.value = "";
      message.value = "";
    },
  );
  watch(
    () => props.selected,
    (path) => {
      if (path && !selection.paths.value.has(path)) selection.replace(path);
    },
    { immediate: true },
  );
  onBeforeUnmount(() => drag.clear());
}
const { resolver, error: themeError } = useFileIconTheme();
const rows = computed(() =>
  entries.value.map((entry) => ({
    entry,
    decoration: gitDecorations.value.get(entry.path),
    icon: resolver.value.resolve(entry, expanded.value.has(entry.path)),
  })),
);
const error = ref("");
const loading = ref(false);
const truncated = ref(false);
let generation = 0;
watch(
  () => [props.projectId, props.path, props.revision],
  async () => {
    const current = ++generation;
    loading.value = true;
    error.value = "";
    try {
      const data = await workspaceRequest<{ entries: FileEntry[]; truncated: boolean }>(
        props.projectId,
        "tree",
        { path: props.path },
      );
      if (current !== generation) return;
      const remaining = new Set(data.entries.map((entry) => entry.path));
      for (const entry of entries.value)
        if (!remaining.has(entry.path)) selection.relocate(entry.path);
      entries.value = data.entries;
      truncated.value = data.truncated;
    } catch (err) {
      if (current === generation) error.value = err instanceof Error ? err.message : "Ошибка";
    } finally {
      if (current === generation) loading.value = false;
    }
  },
  { immediate: true },
);
function toggle(path: string) {
  if (expanded.value.has(path)) expanded.value.delete(path);
  else expanded.value.add(path);
}
function startDrag(event: DragEvent, entry: FileEntry) {
  if (busy.value || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  if (!selection.paths.value.has(entry.path)) selection.replace(entry.path);
  selection.dragged.value = topLevelTreePaths(selection.paths.value);
  source.value = entry.path;
  event.dataTransfer.effectAllowed = "copyMove";
  event.dataTransfer.setData(
    treeDragType,
    JSON.stringify({
      projectId: props.projectId,
      path: entry.path,
      paths: selection.dragged.value,
    }),
  );
}
function destinationFor(entry?: FileEntry) {
  return entry ? (entry.directory ? entry.path : parentPath(entry.path)) : props.path;
}
function dragOver(event: DragEvent, entry?: FileEntry) {
  if (!source.value || busy.value || !event.dataTransfer?.types.includes(treeDragType)) return;
  event.preventDefault();
  const directory = destinationFor(entry);
  const valid = selection.dragged.value.every((path) => !!moveDestination(path, directory));
  event.dataTransfer.dropEffect = valid ? "move" : "none";
  drag.hover(valid ? directory : undefined, valid && !!entry?.directory);
}
function dragLeave(event: DragEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null))
    drag.hover();
}
async function drop(event: DragEvent, entry?: FileEntry) {
  if (!source.value || busy.value || !event.dataTransfer?.types.includes(treeDragType)) return;
  event.preventDefault();
  const directory = destinationFor(entry);
  const paths = [...selection.dragged.value];
  if (!paths.length || paths.some((path) => !moveDestination(path, directory))) {
    drag.clear();
    return;
  }
  const projectId = props.projectId;
  moveError.value = "";
  message.value = "";
  busy.value = true;
  drag.clear();
  try {
    if (props.beforeChange)
      for (const path of paths)
        if (!(await props.beforeChange(path)))
          throw new Error("Сначала сохраните изменения открытых файлов");
    for (const path of paths) {
      const result = await moveWorkspaceEntry(projectId, path, directory);
      if (projectId !== props.projectId) return;
      expanded.value = new Set(
        [...expanded.value].map((value) => relocatedPath(value, result.source, result.destination)),
      );
      selection.relocate(result.source, result.destination);
      if (directory) expanded.value.add(directory);
      emit("moved", result.source, result.destination);
    }
    message.value = `Перенесено записей: ${paths.length}`;
  } catch (err) {
    if (projectId === props.projectId)
      moveError.value = err instanceof Error ? err.message : "Не удалось перенести запись";
  } finally {
    busy.value = false;
  }
}
let revealObserver: MutationObserver | undefined;
let revealTimer: ReturnType<typeof setTimeout> | undefined;
function reveal(path: string) {
  selection.replace(path);
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) expanded.value.add(parts.slice(0, i).join("/"));
  revealObserver?.disconnect();
  clearTimeout(revealTimer);
  const find = () => {
    const element = tree.value?.querySelector<HTMLButtonElement>(
      `button[data-path="${CSS.escape(path)}"]`,
    );
    if (!element) return;
    element.scrollIntoView({ block: "nearest" });
    element.focus();
    revealObserver?.disconnect();
    clearTimeout(revealTimer);
  };
  void nextTick(() => {
    if (!tree.value) return;
    revealObserver = new MutationObserver(find);
    revealObserver.observe(tree.value, { childList: true, subtree: true });
    revealTimer = setTimeout(() => revealObserver?.disconnect(), 5000);
    find();
  });
}
const tree = ref<HTMLElement>();
onBeforeUnmount(() => {
  revealObserver?.disconnect();
  clearTimeout(revealTimer);
});
defineExpose({ reveal });
</script>
<template>
  <ul
    ref="tree"
    class="tree"
    :class="{ 'tree-root': depth === 0, 'root-target': depth === 0 && target === '' }"
    :role="depth === 0 ? 'tree' : 'group'"
    :aria-multiselectable="depth === 0 ? true : undefined"
    :aria-label="path || 'Файлы проекта'"
    :aria-busy="busy || loading"
    @dragover.stop="dragOver($event)"
    @drop.stop="drop($event)"
    @contextmenu.self="showContext($event)"
    @dragleave="dragLeave"
  >
    <li v-if="depth === 0 && busy" class="notice" role="status">выполняется…</li>
    <li v-if="depth === 0 && moveError" class="notice error" role="alert">{{ moveError }}</li>
    <li v-if="depth === 0 && message" class="notice" role="status">{{ message }}</li>
    <li v-if="error" class="notice error" role="alert">{{ error }}</li>
    <li v-if="depth === 0 && themeError" class="notice error" role="status">{{ themeError }}</li>
    <li v-for="{ entry, icon, decoration } in rows" :key="entry.path" role="none">
      <button
        :class="{
          'git-changed': !!decoration,
          selected: selection.paths.value.has(entry.path),
          dragging: selection.dragged.value.includes(entry.path) && !!source,
          'drop-target': entry.directory && target === entry.path,
        }"
        :draggable="!busy"
        :data-path="entry.path"
        :data-git-status="decoration"
        :style="{ paddingLeft: `${12 + depth * 14}px` }"
        :title="decoration ? `${entry.path} · ${gitLabels[decoration]}` : entry.path"
        :aria-selected="selection.paths.value.has(entry.path)"
        role="treeitem"
        :aria-level="depth + 1"
        :aria-expanded="entry.directory ? expanded.has(entry.path) : undefined"
        @contextmenu.stop="showContext($event, entry)"
        @keydown.stop="entryKey($event, entry)"
        @focus="activateEntry(entry)"
        @click="clickEntry($event, entry)"
        @dragstart.stop="startDrag($event, entry)"
        @dragend.stop="drag.clear()"
        @dragover.stop="dragOver($event, entry)"
        @drop.stop="drop($event, entry)"
      >
        <span class="glyph" aria-hidden="true">
          <IconChevronRight
            v-if="entry.directory"
            :class="{ expanded: expanded.has(entry.path) }"
          />
        </span>
        <FileIcon :icon="icon" />
        <span class="name">{{ entry.name }}</span>
      </button>
      <FileTree
        v-if="entry.directory && expanded.has(entry.path)"
        :project-id="projectId"
        :path="entry.path"
        :selected="selected"
        :depth="depth + 1"
        :revision="revision"
        :before-change="beforeChange"
        @changed="emit('changed')"
        @deleted="emit('deleted', $event)"
        @open="emit('open', $event)"
        @moved="(source, destination) => emit('moved', source, destination)"
      />
    </li>
    <li v-if="truncated" class="notice">показаны первые 1000 записей</li>
    <li
      v-if="depth === 0"
      class="root-space"
      @click="selection.replace()"
      @contextmenu.stop="showContext($event)"
    ></li>
  </ul>
  <ContextMenu v-if="depth === 0" ref="menu" :items="menuItems" label="Действия с файлами" />
  <EntryDialog v-if="depth === 0" ref="dialog" @submit="runOperation($event)" />
</template>
<style scoped>
.tree {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 12px;
  user-select: none;
}
.tree-root {
  min-height: 100%;
}
.root-space {
  min-height: 64px;
}
.root-target {
  box-shadow: inset 0 0 0 1px var(--accent, #b8ab77);
}
button.dragging {
  opacity: 0.45;
}
button.drop-target {
  background: var(--bg-2);
  color: var(--text);
  outline: 1px solid var(--accent, #b8ab77);
  outline-offset: -1px;
}
button {
  width: 100%;
  display: flex;
  gap: 6px;
  align-items: center;
  text-align: left;
  padding: 5px 10px;
  color: var(--muted);
}
button.git-changed {
  --git-tint: #d6b46f;
  box-shadow: inset 0 0 0 100vmax color-mix(in srgb, var(--git-tint) 11%, transparent);
}
button[data-git-status="added"] {
  --git-tint: var(--run);
}
button[data-git-status="deleted"] {
  --git-tint: var(--err);
}
button[data-git-status="conflict"] {
  --git-tint: #e58e80;
}
button.git-changed.selected {
  box-shadow: inset 0 0 0 100vmax color-mix(in srgb, var(--git-tint) 18%, transparent);
}
button:hover {
  background: var(--bg-2);
  color: var(--text);
}
button.selected {
  background: #282820;
  color: var(--text);
}
.glyph {
  width: 12px;
  flex-shrink: 0;
  color: var(--faint);
  display: flex;
  align-items: center;
}
.glyph svg {
  width: 12px;
  height: 12px;
  transition: transform 120ms ease;
}
.glyph svg.expanded {
  transform: rotate(90deg);
}
@media (prefers-reduced-motion: reduce) {
  .glyph svg {
    transition: none;
  }
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notice {
  padding: 8px 12px;
  color: var(--faint);
}
.error {
  color: var(--err);
}
</style>
