<script setup lang="ts">
import { computed, ref } from "vue";
import IconChevronRight from "~icons/lucide/chevron-right";
import { FileIcon, useFileIconTheme } from "../../file-icons/index.ts";
import type { GitOverview } from "../../../../core/modules/workspace/index.ts";

type Change = GitOverview["changes"][number];
const props = withDefaults(
  defineProps<{
    changes: Change[];
    staged: boolean;
    selected: string;
    path?: string;
    depth?: number;
  }>(),
  { path: "", depth: 0 },
);
const emit = defineEmits<{ open: [path: string] }>();
const collapsed = ref(new Set<string>());
const { resolver } = useFileIconTheme();
const rows = computed(() => {
  const entries = new Map<
    string,
    {
      name: string;
      path: string;
      directory: boolean;
      changes: Change[];
    }
  >();
  const prefix = props.path ? `${props.path}/` : "";
  for (const change of props.changes) {
    const relative = change.path.slice(prefix.length);
    const name = relative.split("/")[0]!;
    const path = `${prefix}${name}`;
    let entry = entries.get(path);
    if (!entry) {
      entry = { name, path, directory: relative.includes("/"), changes: [] };
      entries.set(path, entry);
    }
    entry.changes.push(change);
  }
  return [...entries.values()]
    .map((entry) => {
      if (!entry.directory) return entry;
      // Compact only a sole directory child; files and branches end the chain.
      while (true) {
        const relatives = entry.changes.map((change) => change.path.slice(entry.path.length + 1));
        const child = relatives[0]!.split("/")[0]!;
        if (!relatives.every((path) => path.startsWith(`${child}/`))) break;
        entry = { ...entry, name: `${entry.name}/${child}`, path: `${entry.path}/${child}` };
      }
      return entry;
    })
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
    .map((entry) => ({
      ...entry,
      icon: resolver.value.resolve(
        { ...entry, name: entry.name.split("/").at(-1)! },
        !collapsed.value.has(entry.path),
      ),
      change: entry.changes[0]!,
    }));
});
function toggle(path: string) {
  if (collapsed.value.has(path)) collapsed.value.delete(path);
  else collapsed.value.add(path);
}
</script>

<template>
  <ul
    class="git-tree"
    :aria-label="path || (staged ? 'Подготовленные изменения' : 'Рабочие изменения')"
  >
    <li v-for="entry in rows" :key="entry.path">
      <button
        :class="{ selected: !entry.directory && selected === entry.path }"
        :style="{ paddingLeft: `${12 + depth * 14}px` }"
        :data-path="entry.path"
        :title="
          !entry.directory && entry.change.originalPath
            ? `${entry.change.originalPath} → ${entry.path}`
            : entry.path
        "
        :aria-expanded="entry.directory ? !collapsed.has(entry.path) : undefined"
        :aria-current="!entry.directory && selected === entry.path ? 'true' : undefined"
        @click="entry.directory ? toggle(entry.path) : emit('open', entry.path)"
      >
        <span class="glyph" aria-hidden="true">
          <IconChevronRight
            v-if="entry.directory"
            :class="{ expanded: !collapsed.has(entry.path) }"
          />
        </span>
        <FileIcon :icon="entry.icon" />
        <span class="name">{{ entry.name }}</span>
        <span v-if="entry.directory" class="count">{{ entry.changes.length }}</span>
        <b v-else class="status">{{ staged ? entry.change.index : entry.change.worktree }}</b>
      </button>
      <GitChangesTree
        v-if="entry.directory"
        v-show="!collapsed.has(entry.path)"
        :changes="entry.changes"
        :path="entry.path"
        :depth="depth + 1"
        :staged="staged"
        :selected="selected"
        @open="emit('open', $event)"
      />
    </li>
  </ul>
</template>

<style scoped>
.git-tree {
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
.glyph svg {
  width: 12px;
  height: 12px;
  display: block;
}
.glyph svg.expanded {
  transform: rotate(90deg);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count,
.status {
  flex-shrink: 0;
  font: 11px var(--mono);
}
.count {
  color: var(--faint);
}
.status {
  color: var(--run);
}
</style>
