<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, provide, ref, watch } from "vue";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import EntryDialog from "../../../common/ui/EntryDialog.vue";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import IconChevronRight from "~icons/lucide/chevron-right";
import { FileIcon } from "../../file-icons/index.ts";
import { useFileIconTheme } from "../../file-icons/index.ts";
import { workspaceRequest, moveWorkspaceEntry, mutateWorkspaceEntry } from "../api.ts";
import { createTreeDrag, treeDragKey, treeDragType } from "../tree-drag.ts";
import {
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
const drag = props.depth === 0 ? createTreeDrag() : inject(treeDragKey)!;
if (props.depth === 0) provide(treeDragKey, drag);
const menu = ref<InstanceType<typeof ContextMenu>>();
const dialog = ref<InstanceType<typeof EntryDialog>>();
const contextEntry = ref<FileEntry>();
const clipboard = ref<{ path: string; cut: boolean }>();
const operation = ref<{ action: string; path: string; directory: string; projectId: string }>();
type OpenContext = (event: MouseEvent | KeyboardEvent, entry?: FileEntry) => void;
const showContext: OpenContext =
  props.depth === 0
    ? (event, entry) => {
        if (drag.busy.value) {
          event.preventDefault();
          return;
        }
        contextEntry.value = entry;
        void menu.value?.open(event);
      }
    : inject<OpenContext>("workspace-context")!;
if (props.depth === 0) provide("workspace-context", showContext);
function requestAction(action: string, initial = "") {
  const entry = contextEntry.value;
  const directory = entry?.directory ? entry.path : parentPath(entry?.path ?? "");
  operation.value = { action, path: entry?.path ?? "", directory, projectId: props.projectId };
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
          ? `${entry?.path}. Запись будет перемещена в .projector-trash в корне проекта.`
          : undefined,
    }),
  );
}
async function runOperation(name: string) {
  const op = operation.value;
  if (!op) return;
  busy.value = true;
  moveError.value = "";
  message.value = "";
  try {
    if (
      ["rename", "delete"].includes(op.action) &&
      props.beforeChange &&
      !(await props.beforeChange(op.path))
    )
      throw new Error("Сначала сохраните изменения открытых файлов");
    const result = await mutateWorkspaceEntry(
      op.projectId,
      op.action,
      op.path,
      op.action === "copy" ? parentPath(op.path) : op.directory,
      name,
    );
    dialog.value?.close();
    if (op.projectId !== props.projectId) return;
    if (op.action === "rename") {
      expanded.value = new Set(
        [...expanded.value].map((path) => relocatedPath(path, op.path, result.destination!)),
      );
      if (clipboard.value)
        clipboard.value.path = relocatedPath(clipboard.value.path, op.path, result.destination!);
      emit("moved", op.path, result.destination!);
    } else if (op.action === "delete") {
      expanded.value = new Set(
        [...expanded.value].filter((path) => path !== op.path && !path.startsWith(op.path + "/")),
      );
      if (
        clipboard.value &&
        (clipboard.value.path === op.path || clipboard.value.path.startsWith(op.path + "/"))
      )
        clipboard.value = undefined;
      emit("deleted", op.path);
    } else {
      if (op.directory) expanded.value.add(op.directory);
      emit("changed");
      if (op.action === "create-file") emit("open", result.destination!);
    }
    message.value = "Готово";
  } catch (error) {
    dialog.value?.fail(error instanceof Error ? error.message : "Не удалось выполнить действие");
  } finally {
    busy.value = false;
  }
}
async function paste() {
  const clip = clipboard.value;
  if (!clip) return;
  const directory = contextEntry.value?.directory
    ? contextEntry.value.path
    : parentPath(contextEntry.value?.path ?? "");
  busy.value = true;
  moveError.value = "";
  const projectId = props.projectId;
  try {
    if (clip.cut && props.beforeChange && !(await props.beforeChange(clip.path)))
      throw new Error("Сначала сохраните изменения открытых файлов");
    const result = clip.cut
      ? await moveWorkspaceEntry(projectId, clip.path, directory)
      : await mutateWorkspaceEntry(
          projectId,
          "copy",
          clip.path,
          directory,
          clip.path.split("/").at(-1)!,
        );
    if (projectId !== props.projectId) return;
    if (directory) expanded.value.add(directory);
    if (clip.cut) {
      expanded.value = new Set(
        [...expanded.value].map((path) => relocatedPath(path, clip.path, result.destination!)),
      );
      emit("moved", clip.path, result.destination!);
      clipboard.value = undefined;
    } else emit("changed");
    message.value = "Готово";
  } catch (error) {
    moveError.value = error instanceof Error ? error.message : "Не удалось вставить";
  } finally {
    busy.value = false;
  }
}
async function copyPath(relative: boolean) {
  try {
    const path = contextEntry.value?.path ?? "";
    if (relative) await navigator.clipboard.writeText(path || ".");
    else {
      const data = await workspaceRequest<{ root: string }>(props.projectId, "root");
      await navigator.clipboard.writeText(data.root + (path ? "/" + path : ""));
    }
  } catch {
    moveError.value = "Не удалось скопировать путь в буфер обмена";
  }
}
const menuItems = computed<ContextMenuItem[]>(() => {
  const entry = contextEntry.value;
  const items: ContextMenuItem[] = [];
  if (entry && !entry.directory)
    items.push({ id: "open", label: "Открыть", run: () => emit("open", entry.path) });
  if (!entry || entry.directory)
    items.push(
      { id: "new-file", label: "Новый файл…", run: () => requestAction("create-file") },
      { id: "new-directory", label: "Новая папка…", run: () => requestAction("create-directory") },
    );
  if (entry)
    items.push(
      {
        id: "rename",
        label: "Переименовать…",
        shortcut: "F2",
        separator: true,
        run: () => requestAction("rename", entry.name),
      },
      {
        id: "cut",
        label: "Вырезать",
        shortcut: "Ctrl+X",
        run: () => {
          clipboard.value = { path: entry.path, cut: true };
        },
      },
      {
        id: "copy",
        label: "Копировать",
        shortcut: "Ctrl+C",
        run: () => {
          clipboard.value = { path: entry.path, cut: false };
        },
      },
      {
        id: "duplicate",
        label: "Дублировать…",
        run: () => requestAction("copy", entry.name.replace(/(\.[^.]*)?$/, " copy$1")),
      },
    );
  items.push(
    { id: "paste", label: "Вставить", shortcut: "Ctrl+V", disabled: !clipboard.value, run: paste },
    {
      id: "relative",
      label: "Копировать относительный путь",
      separator: true,
      run: () => copyPath(true),
    },
    { id: "absolute", label: "Копировать полный путь", run: () => copyPath(false) },
  );
  if (entry?.directory)
    items.push({
      id: "collapse",
      label: expanded.value.has(entry.path) ? "Свернуть папку" : "Развернуть папку",
      run: () => toggle(entry.path),
    });
  if (!entry)
    items.push({
      id: "collapse-all",
      label: "Свернуть все папки",
      run: () => expanded.value.clear(),
    });
  items.push({ id: "refresh", label: "Обновить", run: () => emit("changed") });
  if (entry)
    items.push({
      id: "delete",
      label: "Удалить…",
      shortcut: "Delete",
      danger: true,
      separator: true,
      run: () => requestAction("delete"),
    });
  return items;
});
function entryKey(event: KeyboardEvent, entry?: FileEntry) {
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    showContext(event, entry);
    return;
  }
  if (props.depth !== 0) {
    const handler = injectEntryKey;
    handler?.(event, entry);
    return;
  }
  if (busy.value) return;
  contextEntry.value = entry;
  const command = event.ctrlKey || event.metaKey;
  if (event.key === "F2" && entry) requestAction("rename", entry.name);
  else if (event.key === "Delete" && entry) requestAction("delete");
  else if (command && event.key.toLowerCase() === "c" && entry)
    clipboard.value = { path: entry.path, cut: false };
  else if (command && event.key.toLowerCase() === "x" && entry)
    clipboard.value = { path: entry.path, cut: true };
  else if (command && event.key.toLowerCase() === "v") void paste();
  else return;
  event.preventDefault();
  event.stopPropagation();
}
const injectEntryKey = props.depth
  ? inject<(event: KeyboardEvent, entry?: FileEntry) => void>("workspace-entry-key")
  : undefined;
if (props.depth === 0) provide("workspace-entry-key", entryKey);
const { source, target, busy, expanded, error: moveError, message } = drag;
if (props.depth === 0) {
  watch(
    () => props.projectId,
    () => {
      menu.value?.close(false);
      dialog.value?.close();
      clipboard.value = undefined;
      drag.clear();
      expanded.value.clear();
      moveError.value = "";
      message.value = "";
    },
  );
  onBeforeUnmount(() => drag.clear());
}
const { resolver, error: themeError } = useFileIconTheme();
const rows = computed(() =>
  entries.value.map((entry) => ({
    entry,
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
  source.value = entry.path;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(
    treeDragType,
    JSON.stringify({ projectId: props.projectId, path: entry.path }),
  );
}
function destinationFor(entry?: FileEntry) {
  return entry ? (entry.directory ? entry.path : parentPath(entry.path)) : props.path;
}
function dragOver(event: DragEvent, entry?: FileEntry) {
  if (!source.value || busy.value || !event.dataTransfer?.types.includes(treeDragType)) return;
  event.preventDefault();
  const directory = destinationFor(entry);
  const valid = !!moveDestination(source.value, directory);
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
  const path = source.value;
  if (!moveDestination(path, directory)) {
    drag.clear();
    return;
  }
  const projectId = props.projectId;
  moveError.value = "";
  message.value = "";
  busy.value = true;
  drag.clear();
  try {
    if (props.beforeChange && !(await props.beforeChange(path)))
      throw new Error("Сначала сохраните изменения открытых файлов");
    const result = await moveWorkspaceEntry(projectId, path, directory);
    if (projectId !== props.projectId) return;
    expanded.value = new Set(
      [...expanded.value].map((value) => relocatedPath(value, result.source, result.destination)),
    );
    if (directory) expanded.value.add(directory);
    message.value = `Перенесено: ${result.source} → ${result.destination}`;
    emit("moved", result.source, result.destination);
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
    :aria-label="path || 'Файлы проекта'"
    :aria-busy="busy || loading"
    @dragover.stop="dragOver($event)"
    @drop.stop="drop($event)"
    @contextmenu.self="showContext($event)"
    @dragleave="dragLeave"
  >
    <li
      v-if="depth === 0"
      class="root-label"
      :class="{ 'drop-target': target === '' }"
      title="Корень проекта"
      tabindex="0"
      @contextmenu.stop="showContext($event)"
      @keydown.stop="entryKey($event)"
    >
      Корень проекта
    </li>
    <li v-if="depth === 0 && busy" class="notice" role="status">выполняется…</li>
    <li v-if="depth === 0 && moveError" class="notice error" role="alert">{{ moveError }}</li>
    <li v-if="depth === 0 && message" class="notice" role="status">{{ message }}</li>
    <li v-if="error" class="notice error" role="alert">{{ error }}</li>
    <li v-if="depth === 0 && themeError" class="notice error" role="status">{{ themeError }}</li>
    <li v-for="{ entry, icon } in rows" :key="entry.path">
      <button
        :class="{
          selected: !entry.directory && entry.path === selected,
          dragging: source === entry.path,
          'drop-target': entry.directory && target === entry.path,
        }"
        :draggable="!busy"
        :data-path="entry.path"
        :style="{ paddingLeft: `${12 + depth * 14}px` }"
        :title="entry.path"
        :aria-expanded="entry.directory ? expanded.has(entry.path) : undefined"
        @contextmenu.stop="showContext($event, entry)"
        @keydown.stop="entryKey($event, entry)"
        @click="entry.directory ? toggle(entry.path) : emit('open', entry.path)"
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
    <li v-if="depth === 0" class="root-space" @contextmenu.stop="showContext($event)"></li>
  </ul>
  <ContextMenu v-if="depth === 0" ref="menu" :items="menuItems" label="Действия с файлами" />
  <EntryDialog v-if="depth === 0" ref="dialog" @submit="runOperation" />
</template>
<style scoped>
.tree {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 12px;
}
.tree-root {
  min-height: 100%;
}
.root-label {
  padding: 8px 12px;
  color: var(--faint);
  font-size: 11px;
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
button.drop-target,
.root-label.drop-target {
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
