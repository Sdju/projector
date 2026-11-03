<script lang="ts">
export interface ChangesSummary {
  files: number;
  additions: number;
  deletions: number;
  capped?: boolean;
  truncated?: boolean;
}
</script>
<script setup lang="ts">
import UiScrollArea from "../../../../../common/ui/UiScrollArea.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiActionRow from "../../../../../common/ui/UiActionRow.vue";
import MiddleTruncate from "../../../../../common/ui/MiddleTruncate.vue";
import { computed, ref, useId, watch } from "vue";
import type { FileChange, FileChangeKind } from "../../../../../../core/modules/workspace/index.ts";
import { FileIcon, useFileIconTheme } from "../../../../file-icons/index.ts";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconCollapse from "~icons/lucide/chevrons-down-up";

/** Плоский список изменений, показанный как дерево; общий для сравнения и merge request. */
const props = withDefaults(
  defineProps<{
    changes: FileChange[];
    selected?: string;
    totals?: ChangesSummary;
    emptyText?: string;
  }>(),
  { selected: "", emptyText: "Файлов нет" },
);
const emit = defineEmits<{
  open: [path: string, pinned?: boolean, originalPath?: string];
}>();

interface DirNode {
  name: string;
  path: string;
  directories: DirNode[];
  files: FileChange[];
}
interface Row {
  kind: "directory" | "file";
  name: string;
  path: string;
  depth: number;
  files?: number;
  additions?: number;
  deletions?: number;
  file?: FileChange;
}

const query = ref("");
const expanded = ref(new Set<string>());
const selected = ref(props.selected);
const inputId = useId();
const { resolver } = useFileIconTheme();

const MARK: Record<FileChangeKind, string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  copied: "C",
  conflict: "U",
};

function build(files: FileChange[]) {
  const root: DirNode = { name: "", path: "", directories: [], files: [] };
  const directories = new Map<string, DirNode>([["", root]]);
  const bucket = (path: string) => {
    if (directories.has(path)) return directories.get(path)!;
    const parts = path.split("/");
    let parent = root;
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      let node = directories.get(current);
      if (!node) {
        node = { name: part, path: current, directories: [], files: [] };
        directories.set(current, node);
        parent.directories.push(node);
      }
      parent = node;
    }
    return parent;
  };
  for (const file of files) {
    const slash = file.path.lastIndexOf("/");
    bucket(slash < 0 ? "" : file.path.slice(0, slash)).files.push(file);
  }
  return root;
}

/** GitLab collapses single-child directory chains; the root keeps its own first row. */
function fold(node: DirNode, rootLevel: boolean) {
  let name = node.name;
  let path = node.path;
  let target = node;
  if (!rootLevel) {
    while (target.directories.length === 1 && target.files.length === 0) {
      const child = target.directories[0]!;
      name = name ? `${name}/${child.name}` : child.name;
      path = child.path;
      target = child;
    }
  }
  return { name, path, node: target };
}

function fileRow(file: FileChange, depth: number): Row {
  const name = file.path.split("/").pop() || file.path;
  return { kind: "file", name, path: file.path, depth, file };
}

function flatten(node: DirNode, depth: number, rootLevel: boolean, allExpanded: boolean): Row[] {
  const rows: Row[] = [];
  const directories = [...node.directories].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
  for (const directory of directories) {
    const folded = fold(directory, rootLevel);
    const stats = directoryStats(folded.node);
    rows.push({ kind: "directory", name: folded.name, path: folded.path, depth, ...stats });
    if (allExpanded || expanded.value.has(folded.path))
      rows.push(...flatten(folded.node, depth + 1, false, allExpanded));
  }
  const files = [...node.files].sort((left, right) =>
    left.path.localeCompare(right.path, undefined, { sensitivity: "base" }),
  );
  for (const file of files) rows.push(fileRow(file, depth));
  return rows;
}

function directoryStats(directory: DirNode) {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  const walk = (node: DirNode) => {
    for (const file of node.files) {
      files++;
      additions += file.additions ?? 0;
      deletions += file.deletions ?? 0;
    }
    for (const child of node.directories) walk(child);
  };
  walk(directory);
  return { files, additions, deletions };
}

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return needle
    ? props.changes.filter((file) => file.path.toLowerCase().includes(needle))
    : props.changes;
});
const searching = computed(() => query.value.trim().length > 0);
const rows = computed(() => flatten(build(filtered.value), 0, true, searching.value));
const totals = computed<ChangesSummary>(() => {
  if (props.totals) return props.totals;
  return {
    files: props.changes.length,
    additions: props.changes.reduce((sum, file) => sum + (file.additions ?? 0), 0),
    deletions: props.changes.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
  };
});

function toggle(path: string) {
  if (expanded.value.has(path)) expanded.value.delete(path);
  else expanded.value.add(path);
}
function directoryPaths(files: FileChange[]) {
  const next = new Set<string>();
  const walk = (node: DirNode, rootLevel: boolean) => {
    for (const directory of node.directories) {
      const folded = fold(directory, rootLevel);
      next.add(folded.path);
      walk(folded.node, false);
    }
  };
  walk(build(files), true);
  return next;
}
function expandAll() {
  expanded.value = expanded.value.size ? new Set() : directoryPaths(filtered.value);
}
function choose(row: Row, event?: MouseEvent) {
  if (row.kind === "directory") {
    toggle(row.path);
    return;
  }
  selected.value = row.path;
  emit("open", row.path, (event?.detail ?? 1) >= 2, row.file?.originalPath);
}
function reveal(path: string) {
  selected.value = path;
  const parts = path.split("/");
  const next = new Set(expanded.value);
  for (let index = 1; index < parts.length; index++) next.add(parts.slice(0, index).join("/"));
  expanded.value = next;
}

watch(
  () => props.changes,
  (next) => {
    expanded.value = directoryPaths(next);
  },
  { immediate: true },
);
watch(
  () => props.selected,
  (path) => {
    selected.value = path;
  },
);
defineExpose({ reveal });
</script>

<template>
  <div class="changes-tree">
    <div class="head">
      <span class="totals">
        {{ totals.files }}{{ totals.capped ? "+" : "" }} файлов
        <b class="add">+{{ totals.additions }}</b>
        <b class="del">−{{ totals.deletions }}</b>
      </span>
      <button
        type="button"
        class="expand"
        :title="expanded.size ? 'Свернуть дерево' : 'Развернуть дерево'"
        :aria-label="expanded.size ? 'Свернуть дерево' : 'Развернуть дерево'"
        @click="expandAll"
      >
        <IconCollapse aria-hidden="true" />
      </button>
    </div>
    <label class="search">
      <span class="sr-only">Фильтр изменённых файлов</span>
      <input
        :id="inputId"
        :name="inputId"
        v-model="query"
        type="search"
        placeholder="Фильтр по пути"
        autocomplete="off"
        spellcheck="false"
      />
    </label>
    <UiScrollArea class="body">
      <UiHint v-if="!rows.length" size="xs" leading="inherit" class="note">
        {{ searching ? "Ничего не найдено" : emptyText }}
      </UiHint>
      <ul v-else class="tree" role="tree" aria-label="Изменённые файлы">
        <li v-for="row in rows" :key="`${row.kind}:${row.path}`" role="none">
          <UiActionRow
            v-if="row.kind === 'directory'"
            interaction="item"
            radius="none"
            tone="muted"
            :gap="1.5"
            padding="5px 10px"
            class="directory"
            role="treeitem"
            :aria-level="row.depth + 1"
            :aria-expanded="expanded.has(row.path) || searching"
            :title="row.path"
            :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
            @click="choose(row)"
          >
            <span class="glyph" aria-hidden="true">
              <IconChevronRight
                class="chevron"
                :class="{ expanded: expanded.has(row.path) || searching }"
              />
            </span>
            <MiddleTruncate class="name" :text="row.name" />
            <span class="count">{{ row.files }}</span>
            <span class="add">+{{ row.additions }}</span>
            <span class="del">−{{ row.deletions }}</span>
          </UiActionRow>
          <UiActionRow
            v-else
            interaction="item"
            radius="none"
            tone="muted"
            :gap="1.5"
            padding="5px 10px"
            class="file"
            role="treeitem"
            :aria-level="row.depth + 1"
            :aria-selected="selected === row.path"
            :class="{ selected: selected === row.path, lifted: row.file?.generated }"
            :disabled="row.file?.binary || row.file?.tooLarge"
            :title="
              row.file?.binary
                ? 'Бинарный файл'
                : row.file?.tooLarge
                  ? 'Файл слишком большой для diff'
                  : row.path
            "
            :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
            @click="choose(row, $event)"
          >
            <span class="glyph" aria-hidden="true" />
            <FileIcon
              :icon="resolver.resolve({ name: row.name, path: row.path, directory: false }, false)"
            />
            <MiddleTruncate class="name" :text="row.name" />
            <span v-if="row.file?.binary" class="mark binary" title="Бинарный файл">bin</span>
            <span v-else-if="row.file?.tooLarge" class="mark large" title="Файл слишком большой"
              >!</span
            >
            <span
              v-if="row.file?.kind && row.file.kind !== 'modified'"
              class="mark"
              :class="row.file.kind"
              :title="row.file.kind"
              >{{ MARK[row.file.kind] }}</span
            >
            <span class="add">+{{ row.file?.additions ?? 0 }}</span>
            <span class="del">−{{ row.file?.deletions ?? 0 }}</span>
          </UiActionRow>
        </li>
      </ul>
      <UiHint v-if="totals.truncated" size="xs" leading="inherit" class="note truncation">
        Показаны не все файлы: источник ограничивает diff.
      </UiHint>
    </UiScrollArea>
  </div>
</template>

<style scoped>
.changes-tree {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3) 0;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.totals {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.expand {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
}
.expand:hover {
  color: var(--text);
  border-color: var(--line-strong);
}
.expand svg {
  width: 12px;
  height: 12px;
}
.search {
  display: block;
  padding: var(--sp-2) var(--sp-3);
}
.search input {
  width: 100%;
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-2);
  color: var(--text);
  font: inherit;
  font-size: var(--fs-2xs);
}
.search input:focus {
  outline: 1px solid var(--focus);
  outline-offset: -1px;
}
.body {
  flex: 1;
  min-height: 0;
}
.tree {
  list-style: none;
  margin: 0;
  padding: 0 0 var(--sp-2);
  font-size: var(--fs-xs);
  user-select: none;
}
.glyph {
  display: flex;
  width: 12px;
  flex-shrink: 0;
  color: var(--faint);
}
.chevron {
  width: 12px;
  height: 12px;
  transition: transform var(--t-fast);
}
.chevron.expanded {
  transform: rotate(90deg);
}
.name {
  flex: 1;
  min-width: 0;
}
.directory .name {
  color: var(--text-2);
}
.file :deep(svg) {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.lifted {
  opacity: 0.65;
}
.count {
  color: var(--faint);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
}
.add,
.del {
  flex-shrink: 0;
  font-family: var(--mono);
  font-size: var(--fs-2xs);
}
.add {
  color: var(--run);
}
.del {
  color: var(--err);
}
.mark {
  flex-shrink: 0;
  width: 12px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-align: center;
}
.mark.added {
  color: var(--run);
}
.mark.deleted {
  color: var(--err);
}
.mark.renamed,
.mark.copied {
  color: var(--accent);
}
.mark.conflict {
  color: var(--err);
}
.mark.binary,
.mark.large {
  width: auto;
  color: var(--warn);
}
.note {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
}
.truncation {
  color: var(--muted);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
