<script setup lang="ts">
import { computed } from "vue";
import type { PlanItem } from "../lib/plan.ts";
import IconListChecks from "~icons/lucide/list-checks";
import IconCheck from "~icons/lucide/check";
import IconLoader from "~icons/lucide/loader-circle";
import IconCircle from "~icons/lucide/circle";

const props = defineProps<{ items: PlanItem[]; busy: boolean }>();
const done = computed(() => props.items.filter((item) => item.status === "completed").length);
const current = computed(() => props.items.find((item) => item.status === "in_progress"));
</script>

<template>
  <details v-if="items.length" class="plan" :open="busy">
    <summary>
      <IconListChecks aria-hidden="true" />
      <span class="plan-title">План</span>
      <span class="plan-count">{{ done }} / {{ items.length }}</span>
      <span v-if="current" class="plan-current">{{ current.active ?? current.content }}</span>
    </summary>
    <ol>
      <li v-for="(item, index) in items" :key="index" :class="item.status">
        <IconCheck v-if="item.status === 'completed'" aria-hidden="true" />
        <IconLoader v-else-if="item.status === 'in_progress'" class="spin" aria-hidden="true" />
        <IconCircle v-else aria-hidden="true" />
        <span>{{ item.content }}</span>
      </li>
    </ol>
  </details>
</template>

<style scoped>
.plan {
  margin: 0 0 var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--bg-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
summary {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  cursor: pointer;
  list-style: none;
}
summary::-webkit-details-marker {
  display: none;
}
svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.plan-title {
  color: var(--text-2);
}
.plan-count {
  font-variant-numeric: tabular-nums;
}
.plan-current {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--faint);
}
ol {
  margin: var(--sp-2) 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 4px;
}
li {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  line-height: 1.5;
}
li svg {
  margin-top: 2px;
}
li.completed {
  color: var(--faint);
  text-decoration: line-through;
}
li.in_progress {
  color: var(--text);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>
