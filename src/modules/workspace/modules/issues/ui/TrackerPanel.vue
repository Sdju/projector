<script setup lang="ts">
import type { TrackerState } from "../lib/paged-list.ts";
import IconChevronRight from "~icons/lucide/chevron-right";

/** Оболочка сайдбар-блока списка (issues, pull requests): заголовок, фильтр, состояния, «ещё». */
defineProps<{
  title: string;
  /** Префикс команд блока: `ide.issues`. */
  prefix: string;
  open: boolean;
  count: number;
  state: TrackerState;
  loading: boolean;
  loadingMore: boolean;
  error: string;
  hasMore: boolean;
  /** Подпись состояний фильтра и пустого списка. */
  noun: string;
}>();
const emit = defineEmits<{ toggle: []; filter: [state: TrackerState]; more: [] }>();
const states: Array<{ value: TrackerState; label: string }> = [
  { value: "open", label: "открытые" },
  { value: "closed", label: "закрытые" },
  { value: "all", label: "все" },
];
</script>

<template>
  <div class="side-content tracker-panel">
    <button
      class="block-toggle"
      type="button"
      :aria-expanded="open"
      :data-command="`${prefix}.block.toggle`"
      @click="emit('toggle')"
    >
      <IconChevronRight class="chevron" :class="{ open }" aria-hidden="true" />
      <h3>
        {{ title }} <span v-if="count" class="count">{{ count }}</span>
      </h3>
    </button>
    <div v-show="open" class="block-body">
      <div class="state-filter" role="group" :aria-label="`Состояние: ${noun}`">
        <button
          v-for="option in states"
          :key="option.value"
          type="button"
          :class="{ active: state === option.value }"
          :aria-pressed="state === option.value"
          @click="emit('filter', option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <p v-if="loading" class="note" role="status">загрузка: {{ noun }}…</p>
      <p v-else-if="error" class="note error" role="alert">{{ error }}</p>
      <p v-else-if="!count" class="note">Нет: {{ noun }}</p>
      <ul v-else class="tracker-list">
        <slot />
      </ul>
      <button
        v-if="hasMore && !loading"
        type="button"
        class="more"
        :disabled="loadingMore"
        @click="emit('more')"
      >
        {{ loadingMore ? "загрузка…" : "Показать ещё" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.tracker-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.block-toggle {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  text-align: left;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}
.block-toggle:hover {
  color: var(--text);
}
.chevron {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  transition: transform var(--t-fast);
}
.chevron.open {
  transform: rotate(90deg);
}
h3 {
  margin: 0;
  font-size: var(--fs-xs);
  font-weight: 500;
  color: inherit;
}
.count {
  color: var(--faint);
  font: var(--fs-2xs) var(--mono);
}
.block-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.state-filter {
  display: flex;
  gap: var(--sp-1);
  padding: var(--sp-2) var(--sp-3);
}
.state-filter button {
  flex: 1;
  padding: 2px var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.state-filter button:hover {
  color: var(--text);
}
.state-filter button.active {
  border-color: var(--focus);
  color: var(--text);
  background: var(--active);
}
.note {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.note.error {
  color: var(--err);
}
.tracker-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.more {
  margin: var(--sp-2) var(--sp-3);
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.more:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--line-strong);
}
.more:disabled {
  opacity: 0.6;
}
</style>
