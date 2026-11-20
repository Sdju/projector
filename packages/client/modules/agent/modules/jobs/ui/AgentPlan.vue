<script setup lang="ts">
import ProjectorIcon from "../../../../../common/icons/ProjectorIcon.vue";
import UiDisclosureSummary from "../../../../../common/ui/UiDisclosureSummary.vue";
import { computed } from "vue";
import type { PlanItem } from "../../../../agent-core/index.ts";
import UiSpinner from "../../../../../common/ui/UiSpinner.vue";

const props = defineProps<{ items: PlanItem[]; busy: boolean; embedded?: boolean }>();
const done = computed(() => props.items.filter((item) => item.status === "completed").length);
const current = computed(() => props.items.find((item) => item.status === "in_progress"));
</script>

<template>
  <details v-if="items.length" class="plan" :class="{ embedded }" :open="busy">
    <UiDisclosureSummary :highlight="false">
      <ProjectorIcon name="list-checks" aria-hidden="true" />
      <span class="plan-title">План</span>
      <span class="plan-count">{{ done }} / {{ items.length }}</span>
      <span v-if="current" class="plan-current u-truncate">{{
        current.active ?? current.content
      }}</span>
      <span class="plan-bar" aria-hidden="true"
        ><span :style="{ width: `${(done / items.length) * 100}%` }"
      /></span>
    </UiDisclosureSummary>
    <ol>
      <li v-for="(item, index) in items" :key="index" :class="item.status">
        <ProjectorIcon name="check" v-if="item.status === 'completed'" aria-hidden="true" />
        <UiSpinner v-else-if="item.status === 'in_progress'" />
        <ProjectorIcon name="circle" v-else aria-hidden="true" />
        <span>{{ item.content }}</span>
      </li>
    </ol>
  </details>
</template>

<style scoped>
.plan {
  margin: 0 0 var(--sp-2);
  padding: 0 var(--sp-1);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.plan:hover {
  color: var(--text-2);
}
.plan.embedded {
  margin: 0;
  padding: 0;
}
.plan-bar {
  flex: 0 0 48px;
  height: 2px;
  margin-left: auto;
  border-radius: var(--r-full);
  background: var(--line);
  overflow: hidden;
}
.plan-bar span {
  display: block;
  height: 100%;
  background: var(--run);
  transition: width var(--t-fast);
}
summary {
  min-width: 0;
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
  color: var(--faint);
}
ol {
  margin: var(--sp-2) 0 var(--sp-1) var(--sp-1);
  padding: 0 0 0 var(--sp-3);
  border-left: 1px solid var(--line);
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
</style>
