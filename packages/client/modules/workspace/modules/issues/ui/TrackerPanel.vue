<script setup lang="ts">
import UiListSection from "../../../../../common/ui/UiListSection.vue";
import { computed } from "vue";
import type { TrackerState } from "../lib/paged-list.ts";

/** Оболочка сайдбар-блока списка (issues, pull requests): заголовок, фильтр, состояния, «ещё». */
const props = defineProps<{
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
  /** Фильтры состояния; по умолчанию открытые, закрытые и все. */
  states?: Array<{ value: TrackerState; label: string }>;
}>();
const emit = defineEmits<{ toggle: []; filter: [state: TrackerState]; more: [] }>();
const defaultStates: Array<{ value: TrackerState; label: string }> = [
  { value: "open", label: "открытые" },
  { value: "closed", label: "закрытые" },
  { value: "all", label: "все" },
];
const filters = computed(() => props.states ?? defaultStates);
</script>

<template>
  <UiListSection
    class="tracker-panel"
    :title="title"
    :count="count"
    :open="open"
    :filters="filters"
    :current="state"
    :loading="loading"
    :loading-more="loadingMore"
    :error="error"
    :has-more="hasMore"
    :noun="noun"
    :toggle-command="`${prefix}.block.toggle`"
    @toggle="emit('toggle')"
    @filter="emit('filter', $event)"
    @more="emit('more')"
  >
    <slot />
  </UiListSection>
</template>
