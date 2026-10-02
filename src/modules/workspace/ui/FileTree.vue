<script setup lang="ts">
import { computed, inject, onBeforeUnmount, provide, ref, watch } from "vue";
import IconChevronRight from "~icons/lucide/chevron-right";
import { FileIcon } from "../../file-icons/index.ts";
import { useFileIconTheme } from "../../file-icons/index.ts";
import { workspaceRequest, moveWorkspaceEntry } from "../api.ts";
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
  }>(),
  { path: "", depth: 0 },
);
const emit = defineEmits<{ open: [path: string]; moved: [source: string, destination: string] }>();
const entries = ref<FileEntry[]>([]);
const drag = props.depth === 0 ? createTreeDrag() : inject(treeDragKey)!;
if (props.depth === 0) provide(treeDragKey, drag);
const { source, target, busy, expanded, error: moveError, message } = drag;
if (props.depth === 0) {
  watch(
    () => props.projectId,
    () => {
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
</script>
<template>
  <ul
    class="tree"
    :class="{ 'tree-root': depth === 0, 'root-target': depth === 0 && target === '' }"
    :aria-label="path || 'Файлы проекта'"
    :aria-busy="busy"
    @dragover.stop="dragOver($event)"
    @drop.stop="drop($event)"
    @dragleave="dragLeave"
  >
    <li
      v-if="depth === 0"
      class="root-label"
      :class="{ 'drop-target': target === '' }"
      title="Перенести в корень проекта"
    >
      Корень проекта
    </li>
    <li v-if="depth === 0 && busy" class="notice" role="status">перенос…</li>
    <li v-if="depth === 0 && moveError" class="notice error" role="alert">{{ moveError }}</li>
    <li v-if="depth === 0 && message" class="notice" role="status">{{ message }}</li>
    <li v-if="loading" class="notice">загрузка…</li>
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
        @open="emit('open', $event)"
        @moved="(source, destination) => emit('moved', source, destination)"
      />
    </li>
    <li v-if="!loading && !error && !entries.length" class="notice">пустая папка</li>
    <li v-if="truncated" class="notice">показаны первые 1000 записей</li>
    <li v-if="depth === 0" class="root-space" aria-hidden="true"></li>
  </ul>
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
