<script setup lang="ts">
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import UiStatusDot from "../../../../../common/ui/UiStatusDot.vue";
import type { PipelineJobStep } from "@ai-projector/core/modules/workspace/index.ts";
import {
  durationLabel,
  PIPELINE_STATUS_LABEL,
  PIPELINE_STATUS_TONE,
} from "@ai-projector/core/modules/workspace/index.ts";

defineProps<{ steps: PipelineJobStep[] }>();
</script>

<template>
  <section v-if="steps.length" class="steps">
    <UiHeading as="h3" size="sm" tone="secondary" :space-before="4" :space-after="2"
      >Шаги</UiHeading
    >
    <ol class="list">
      <li v-for="(step, index) in steps" :key="step.number || index">
        <UiStatusDot :tone="PIPELINE_STATUS_TONE[step.status]" shrink />
        <span class="name">{{ step.name || `Шаг ${step.number || index + 1}` }}</span>
        <span class="status">{{ PIPELINE_STATUS_LABEL[step.status] }}</span>
        <span v-if="durationLabel(step.duration)" class="time">{{
          durationLabel(step.duration)
        }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
}
.list li {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  color: var(--text-2);
  font-size: var(--fs-xs);
}
.list li + li {
  border-top: 1px solid var(--line);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status,
.time {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.time {
  font-family: var(--mono);
}
</style>
