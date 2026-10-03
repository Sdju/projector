<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  provide,
  ref,
  watch,
  type ComputedRef,
} from "vue";
import { useSessionSnapshot, treeSessionSchema } from "../session.ts";
import { useTreeOperations } from "../lib/tree-operations.ts";
import { useTreeKeyboard } from "../lib/tree-keyboard.ts";
import { useTreeDragDrop } from "../lib/tree-dnd.ts";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import EntryDialog from "../../../common/ui/EntryDialog.vue";
import IconChevronRight from "~icons/lucide/chevron-right";
import { FileIcon } from "../../file-icons/index.ts";
import { useFileIconTheme } from "../../file-icons/index.ts";
import { workspaceRequest } from "../../workspace-api/index.ts";
import { createTreeDrag, treeDragKey } from "../tree-drag.ts";
import { createTreeSelection, treeSelectionKey } from "../tree-selection.ts";
import {
  gitTreeDecorations,
  type GitDecoration,
  type GitOverview,
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
  open: [path: string, pinned?: boolean];
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
function clickEntry(event: MouseEvent, entry: FileEntry) {
  if (props.depth !== 0) {
    injectClickEntry!(event, entry);
    return;
  }
  if (busy.value) return;
  activateEntry(entry);
  keys!.selectEntry(event, entry);
  if (event.shiftKey || event.ctrlKey || event.metaKey) return;
  if (entry.directory) treeCommands.run("ide.fileTree.directory.toggle");
  else treeCommands.run("ide.fileTree.file.open", { pinned: event.detail >= 2 });
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
  keys!.entryKey(event, entry);
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
const context = { props, emit, selection, drag, tree, menu, dialog, toggle };
// Операции, клавиатура и общая очередь команд есть только у корня; вложенные ветки получают их через inject.
const { contextEntry, clipboard, treeCommands, menuItems, runOperation } = (
  props.depth === 0 ? useTreeOperations(context) : {}
) as ReturnType<typeof useTreeOperations>;
if (props.depth === 0) provide("workspace-tree-commands", treeCommands);
const keys =
  props.depth === 0
    ? useTreeKeyboard({ tree, selection, expanded, busy, contextEntry, treeCommands, toggle })
    : undefined;
const { startDrag, dragOver, dragLeave, drop } = useTreeDragDrop(context);
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
        @open="(path, pinned) => emit('open', path, pinned)"
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
  font-size: var(--fs-xs);
  user-select: none;
}
.tree-root {
  min-height: 100%;
}
.root-space {
  min-height: 64px;
}
.root-target {
  box-shadow: inset 0 0 0 1px var(--accent);
}
button.dragging {
  opacity: 0.45;
}
button.drop-target {
  background: var(--hover);
  color: var(--text);
  outline: 1px solid var(--accent);
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
  --git-tint: var(--warn);
  box-shadow: inset 0 0 0 100vmax color-mix(in srgb, var(--git-tint) 11%, transparent);
}
button[data-git-status="added"] {
  --git-tint: var(--run);
}
button[data-git-status="deleted"] {
  --git-tint: var(--err);
}
button[data-git-status="conflict"] {
  --git-tint: var(--err);
}
button.git-changed.selected {
  box-shadow: inset 0 0 0 100vmax color-mix(in srgb, var(--git-tint) 18%, transparent);
}
button:hover {
  background: var(--hover);
  color: var(--text);
}
button.selected {
  background: var(--active);
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
  transition: transform var(--t-fast);
}
.glyph svg.expanded {
  transform: rotate(90deg);
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notice {
  padding: var(--sp-2) var(--sp-3);
  color: var(--faint);
}
.error {
  color: var(--err);
}
</style>
