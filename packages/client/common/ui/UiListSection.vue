<script setup lang="ts" generic="T extends string">
import UiEmpty from "./UiEmpty.vue";
import UiLoader from "./UiLoader.vue";
import UiMessage from "./UiMessage.vue";
import UiScrollArea from "./UiScrollArea.vue";
import IconChevronRight from "~icons/lucide/chevron-right";

/**
 * Collapsible sidebar list: title with count, status filter, async states and the next-page button.
 * Rows belong to the owner through the default slot; the shell keeps behaviour and styles equal.
 */
defineProps<{
  title: string;
  count: number;
  open: boolean;
  /** Status filter; omit it for a plain list without tabs. */
  filters?: Array<{ value: T; label: string }>;
  current?: T;
  loading: boolean;
  loadingMore: boolean;
  error: string;
  hasMore: boolean;
  /** What the list contains: «issues», «pipelines»; used in loading and empty texts. */
  noun: string;
  filterLabel?: string;
  /** IDE command id advertised on the toggle for the command palette. */
  toggleCommand?: string;
}>();
const emit = defineEmits<{ toggle: []; filter: [value: T]; more: [] }>();
</script>

<template>
  <UiScrollArea class="side-content list-section">
    <button
      class="block-toggle"
      type="button"
      :aria-expanded="open"
      :data-command="toggleCommand"
      @click="emit('toggle')"
    >
      <IconChevronRight class="chevron" :class="{ open }" aria-hidden="true" />
      <h3>
        {{ title }} <span v-if="count" class="count">{{ count }}</span>
      </h3>
    </button>
    <UiScrollArea v-show="open" class="block-body">
      <div
        v-if="filters?.length"
        class="state-filter"
        role="group"
        :aria-label="`${filterLabel ?? 'Состояние'}: ${noun}`"
      >
        <button
          v-for="option in filters"
          :key="option.value"
          type="button"
          :class="{ active: current === option.value }"
          :aria-pressed="current === option.value"
          @click="emit('filter', option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <UiLoader v-if="loading" class="list-loader">загрузка: {{ noun }}…</UiLoader>
      <UiMessage v-else-if="error" variant="note" tone="danger" role="alert">{{ error }}</UiMessage>
      <UiEmpty v-else-if="!count" density="compact" align="start">Нет: {{ noun }}</UiEmpty>
      <ul v-else class="list">
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
    </UiScrollArea>
  </UiScrollArea>
</template>

<style scoped>
.list-section {
  display: flex;
  flex-direction: column;
}
.list-loader {
  padding: var(--sp-2) var(--sp-3);
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
.list {
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
