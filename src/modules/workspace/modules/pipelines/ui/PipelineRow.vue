<script setup lang="ts">
import UiInline from "../../../../../common/ui/UiInline.vue";
import UiStatusDot from "../../../../../common/ui/UiStatusDot.vue";
import type { Pipeline } from "../../../../../../core/modules/workspace/index.ts";
import { relativeTime, shortHash } from "../../../../../common/utilities/commit-format.ts";
import { durationLabel, PIPELINE_STATUS_LABEL, PIPELINE_STATUS_TONE } from "../lib/status.ts";

/** A pipeline row: status, id, ref, commit and duration; clicks belong to the parent. */
defineProps<{ pipeline: Pipeline }>();
</script>

<template>
  <button type="button" class="pipeline-row">
    <UiInline as="span" class="title" :gap="1" align="normal" justify="normal">
      <UiStatusDot
        :tone="PIPELINE_STATUS_TONE[pipeline.status]"
        :title="PIPELINE_STATUS_LABEL[pipeline.status]"
        shrink
      />
      <span class="name">{{ pipeline.name || pipeline.ref || `Pipeline #${pipeline.id}` }}</span>
      <span class="number">#{{ pipeline.id }}</span>
    </UiInline>
    <UiInline as="span" class="meta" wrap justify="normal">
      <span>{{ PIPELINE_STATUS_LABEL[pipeline.status] }}</span>
      <span v-if="pipeline.sha" class="mono">{{ shortHash(pipeline.sha) }}</span>
      <span v-if="pipeline.createdAt" :title="pipeline.createdAt">{{
        relativeTime(pipeline.createdAt)
      }}</span>
      <span v-if="durationLabel(pipeline.duration)">{{ durationLabel(pipeline.duration) }}</span>
    </UiInline>
  </button>
</template>

<style scoped>
.pipeline-row {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  text-align: left;
  color: var(--text-2);
  border-top: 1px solid var(--line);
}
.pipeline-row:hover {
  background: var(--active);
  color: var(--text);
}
.title {
  font-size: var(--fs-xs);
  line-height: 1.35;
}
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
.meta {
  gap: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
</style>
