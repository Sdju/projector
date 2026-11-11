<script setup lang="ts">
import UiListRow from "../../../../../common/ui/UiListRow.vue";
import UiStatusDot from "../../../../../common/ui/UiStatusDot.vue";
import type { Pipeline } from "@ai-projector/core/modules/workspace/index.ts";
import { relativeTime, shortHash } from "../../../../../common/utilities/commit-format.ts";
import {
  durationLabel,
  PIPELINE_STATUS_LABEL,
  PIPELINE_STATUS_TONE,
  refLabel,
  sourceLabel,
} from "@ai-projector/core/modules/workspace/index.ts";

/** A pipeline row: ref, status, source, commit and duration; clicks belong to the parent. */
defineProps<{ pipeline: Pipeline }>();
</script>

<template>
  <UiListRow :label="pipeline.name || pipeline.ref">
    <template #title>
      <UiStatusDot
        :tone="PIPELINE_STATUS_TONE[pipeline.status]"
        :title="PIPELINE_STATUS_LABEL[pipeline.status]"
        shrink
      />
      <span class="name">{{
        pipeline.title || refLabel(pipeline.ref) || pipeline.name || "Pipeline"
      }}</span>
      <span v-if="pipeline.id || pipeline.number" class="number"
        >#{{ pipeline.id || pipeline.number }}</span
      >
    </template>
    <template #meta>
      <span>{{ PIPELINE_STATUS_LABEL[pipeline.status] }}</span>
      <span v-if="pipeline.name && pipeline.title">{{ pipeline.name }}</span>
      <span v-if="pipeline.source">{{ sourceLabel(pipeline.source) }}</span>
      <span v-if="pipeline.sha" class="mono">{{ shortHash(pipeline.sha) }}</span>
      <span v-if="durationLabel(pipeline.duration)">{{ durationLabel(pipeline.duration) }}</span>
      <span v-if="pipeline.createdAt" :title="pipeline.createdAt">{{
        relativeTime(pipeline.createdAt)
      }}</span>
    </template>
  </UiListRow>
</template>

<style scoped>
.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.number,
.mono {
  font-family: var(--mono);
}
</style>
