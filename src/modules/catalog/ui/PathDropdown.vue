<script setup lang="ts">
import IconChevronRight from "~icons/lucide/chevron-right";
import IconFolder from "~icons/lucide/folder";
import type { DirectoryEntry } from "../../../../core/modules/directories/index.ts";
defineProps<{
  /** Id of the listbox; option ids are `${id}-${index}`. */
  id: string;
  heading: string;
  editing: boolean;
  remote?: boolean;
  entries: DirectoryEntry[];
  selected: number;
  loading: boolean;
  error: string;
  truncated: boolean;
  busy: boolean;
}>();
defineEmits<{ pick: [path: string] }>();
</script>
<template>
  <div class="dropdown">
    <div class="dropdown-heading">{{ heading }}</div>
    <p v-if="loading" class="notice" role="status">
      {{ remote ? "Читаю репозитории…" : "Читаю папки…" }}
    </p>
    <p v-else-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-else-if="!entries.length" class="notice">
      {{
        remote
          ? "Подходящих репозиториев нет"
          : editing
            ? "Подходящих папок нет"
            : "Нет вложенных папок"
      }}
    </p>
    <div
      :id="id"
      role="listbox"
      :aria-label="remote ? 'Доступные репозитории' : 'Доступные папки'"
      class="options"
    >
      <button
        v-for="(entry, index) in entries"
        :id="`${id}-${index}`"
        :key="entry.path"
        role="option"
        :aria-selected="selected === index"
        :class="{ highlighted: selected === index }"
        :disabled="busy"
        :title="entry.path"
        @pointerdown.prevent
        @click="$emit('pick', entry.path)"
      >
        <IconFolder aria-hidden="true" /><span>{{ entry.name }}</span
        ><IconChevronRight aria-hidden="true" />
      </button>
    </div>
    <p v-if="truncated" class="notice">
      {{
        remote ? "Первые 1000 репозиториев — уточните путь" : "Первые 1000 папок — уточните путь"
      }}
    </p>
  </div>
</template>
<style scoped>
button {
  font: inherit;
  color: inherit;
}
.dropdown {
  position: absolute;
  top: calc(100% + 5px);
  left: -1px;
  z-index: 30;
  width: min(640px, 100%);
  min-width: min(280px, 100%);
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-popover);
  padding: var(--sp-1);
}
.dropdown-heading {
  padding: var(--sp-2) var(--sp-2);
  font-size: var(--fs-2xs);
  color: var(--faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid var(--line);
}
.options {
  max-height: min(320px, 45dvh);
  overflow-y: auto;
}
.options button {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  padding: var(--sp-2) var(--sp-2);
  text-align: left;
  border-radius: var(--r-sm);
}
.options button svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--faint);
}
.options button svg:last-child {
  margin-left: auto;
  width: 12px;
}
.options button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.options button:hover,
.options button.highlighted,
.options button:focus-visible {
  background: var(--active);
  color: var(--text);
}
.notice {
  margin: 0;
  padding: var(--sp-3) var(--sp-2);
  color: var(--faint);
}
.error {
  color: var(--err);
}
</style>
