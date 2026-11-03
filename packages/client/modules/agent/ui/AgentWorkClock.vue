<script setup lang="ts">
import { computed } from "vue";
import { formatElapsed, useElapsedClock } from "../lib/elapsed.ts";
import IconTimer from "~icons/lucide/timer";

/** How long the agent has been on the current answer: a live label beside the input. */
const props = withDefaults(defineProps<{ startedAt?: number; title?: string }>(), {
  startedAt: undefined,
  title: "Агент работает над ответом",
});
const now = useElapsedClock();
const elapsed = computed(() =>
  props.startedAt === undefined ? "" : formatElapsed(now.value - props.startedAt),
);
</script>

<template>
  <span
    v-if="elapsed"
    class="work-clock"
    role="timer"
    :title="`${title}: ${elapsed}`"
    :aria-label="`${title}: ${elapsed}`"
  >
    <IconTimer aria-hidden="true" />
    <span>{{ elapsed }}</span>
  </span>
</template>

<style scoped>
.work-clock {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
  font-size: var(--fs-2xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
</style>
