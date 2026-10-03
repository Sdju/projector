<script setup lang="ts">
import { computed, ref } from "vue";
import IconPlus from "~icons/lucide/plus";
import IconMinus from "~icons/lucide/minus";
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
    disabled?: boolean;
    canToggle: (path: string) => boolean;
  }>(),
  { path: "", depth: 0 },
);
const emit = defineEmits<{
  open: [path: string];
  target: [path: string];
  change: [path: string];
  context: [event: MouseEvent | KeyboardEvent, path: string];
}>();
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
        {
          ...entry,
          name: entry.name.split("/").at(-1)!,
          executable: !entry.directory && entry.changes[0]!.executable,
        },
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
      <div
        class="git-row"
        :class="{ selected: !entry.directory && selected === entry.path }"
        @contextmenu="emit('context', $event, entry.path)"
        @keydown.shift.f10.prevent="emit('context', $event, entry.path)"
      >
        <button
          class="entry"
          :disabled="disabled"
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
          @focus="emit('target', entry.path)"
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
        <button
          class="git-action"
          :disabled="disabled || !canToggle(entry.path)"
          :title="staged ? 'Убрать из Staged' : 'Отметить Staged'"
          :aria-label="`${staged ? 'Убрать из Staged' : 'Отметить Staged'}: ${entry.path}`"
          :data-command="staged ? 'ide.git.unstage' : 'ide.git.stage'"
          @focus="emit('target', entry.path)"
          @click.stop="emit('change', entry.path)"
        >
          <IconMinus v-if="staged" aria-hidden="true" /><IconPlus v-else aria-hidden="true" />
        </button>
      </div>
      <GitChangesTree
        v-if="entry.directory"
        v-show="!collapsed.has(entry.path)"
        :changes="entry.changes"
        :path="entry.path"
        :depth="depth + 1"
        :staged="staged"
        :disabled="disabled"
        :can-toggle="canToggle"
        :selected="selected"
        @change="emit('change', $event)"
        @open="emit('open', $event)"
        @target="emit('target', $event)"
        @context="(event, path) => emit('context', event, path)"
      />
    </li>
  </ul>
</template>

<style scoped>
.git-tree {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: var(--fs-xs);
}
.git-row {
  display: flex;
  align-items: center;
  padding-right: 8px;
}
.git-row:hover,
.git-row:focus-within {
  background: var(--hover);
}
.git-row.selected {
  background: var(--active);
}
.entry {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 6px;
  align-items: center;
  text-align: left;
  padding: 5px 10px;
  color: var(--muted);
}
.entry:hover {
  background: var(--hover);
  color: var(--text);
}
.entry.selected {
  background: var(--active);
  color: var(--text);
}
.git-action {
  display: grid;
  place-items: center;
  padding: 3px;
  border-radius: var(--r-sm);
  color: var(--muted);
  opacity: 0;
  flex-shrink: 0;
}
.git-action svg {
  width: 14px;
  height: 14px;
}
.git-row:hover .git-action,
.git-row:focus-within .git-action {
  opacity: 1;
}
.git-action:hover:not(:disabled) {
  background: var(--active);
  color: var(--text);
}
.git-action:disabled {
  opacity: 0.35;
}
.entry:focus-visible,
.git-action:focus-visible {
  outline-offset: -2px;
}
@media (hover: none) {
  .git-action {
    opacity: 1;
  }
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
  font: var(--fs-2xs) var(--mono);
}
.count {
  color: var(--faint);
}
.status {
  color: var(--run);
}
</style>
