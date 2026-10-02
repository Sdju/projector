<script setup lang="ts">
import { ref, watch } from "vue";
import { workspaceRequest } from "../api.ts";
import type { FileEntry } from "../../../../shared/workspace.ts";
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
const emit = defineEmits<{ open: [path: string] }>();
const entries = ref<FileEntry[]>([]);
const expanded = ref(new Set<string>());
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
  expanded.value.has(path) ? expanded.value.delete(path) : expanded.value.add(path);
}
</script>
<template>
  <ul class="tree" :aria-label="path || 'Файлы проекта'">
    <li v-if="loading" class="notice">загрузка…</li>
    <li v-if="error" class="notice error" role="alert">{{ error }}</li>
    <li v-for="entry in entries" :key="entry.path">
      <button
        :class="{ selected: !entry.directory && entry.path === selected }"
        :style="{ paddingLeft: `${12 + depth * 14}px` }"
        :title="entry.path"
        :aria-expanded="entry.directory ? expanded.has(entry.path) : undefined"
        @click="entry.directory ? toggle(entry.path) : emit('open', entry.path)"
      >
        <span class="glyph">{{
          entry.directory ? (expanded.has(entry.path) ? "⌄" : "›") : "·"
        }}</span
        ><span class="name">{{ entry.name }}</span>
      </button>
      <FileTree
        v-if="entry.directory && expanded.has(entry.path)"
        :project-id="projectId"
        :path="entry.path"
        :selected="selected"
        :depth="depth + 1"
        :revision="revision"
        @open="emit('open', $event)"
      />
    </li>
    <li v-if="!loading && !error && !entries.length" class="notice">пустая папка</li>
    <li v-if="truncated" class="notice">показаны первые 1000 записей</li>
  </ul>
</template>
<style scoped>
.tree {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 12px;
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
