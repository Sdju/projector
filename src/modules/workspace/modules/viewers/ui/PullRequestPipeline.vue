<script setup lang="ts">
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiStatusDot from "../../../../../common/ui/UiStatusDot.vue";
import { ref } from "vue";
import type { Pipeline } from "../../../../../../core/modules/workspace/index.ts";
import { relativeTime } from "../../../../../common/utilities/commit-format.ts";
import { useCommandRegistrar, useCommandScope } from "../../../../../common/utilities/commands.ts";
import {
  durationLabel,
  PIPELINE_STATUS_LABEL,
  PIPELINE_STATUS_TONE,
} from "../../../../../../core/modules/workspace/index.ts";
import PullRequestPipelineStages from "./PullRequestPipelineStages.vue";
import IconChevronRight from "~icons/lucide/chevron-right";

/** Pipeline merge request: статус, раскрываемый ход по стадиям и переход в полную вкладку. */
const props = withDefaults(
  defineProps<{
    projectId: string;
    pipeline: Pipeline;
    host?: string;
  }>(),
  { host: "GitLab" },
);
const emit = defineEmits<{
  openPipeline: [pipeline: { id: number; title?: string }];
  openJob: [job: { id: number; title: string }];
}>();
const open = ref(false);
const commands = useCommandScope(
  `merge-request-pipeline:${props.projectId}:${props.pipeline.id}`,
  () => ({
    surface: "merge-request-pipeline",
    projectId: props.projectId,
    pipelineId: props.pipeline.id,
  }),
);
const register = useCommandRegistrar(commands.scope);
register(
  "ide.mergeRequest.pipeline.toggle",
  "Показать или скрыть стадии pipeline merge request",
  "Раскрывает ход pipeline по стадиям прямо в карточке merge request.",
  () => {
    open.value = !open.value;
  },
);
</script>

<template>
  <div class="pipeline-card">
    <div class="summary-row">
      <button
        type="button"
        class="summary"
        :aria-expanded="open"
        data-command="ide.mergeRequest.pipeline.toggle"
        :title="open ? 'Свернуть стадии' : 'Показать стадии'"
        @click="open = !open"
      >
        <IconChevronRight class="chevron" :class="{ open }" aria-hidden="true" />
        <UiStatusDot :tone="PIPELINE_STATUS_TONE[pipeline.status]" shrink />
        <span class="title">Pipeline #{{ pipeline.id }}</span>
        <span class="state">{{ PIPELINE_STATUS_LABEL[pipeline.status] }}</span>
        <span v-if="durationLabel(pipeline.duration)" class="meta"
          >за {{ durationLabel(pipeline.duration) }}</span
        >
        <span v-if="pipeline.createdAt" class="meta" :title="pipeline.createdAt"
          >создан {{ relativeTime(pipeline.createdAt) }}</span
        >
      </button>
      <UiButton
        size="sm"
        data-command="ide.mergeRequest.pipeline.open"
        @click="emit('openPipeline', { id: props.pipeline.id, title: props.pipeline.name })"
      >
        Открыть
      </UiButton>
      <a
        v-if="pipeline.webUrl"
        class="external"
        :href="pipeline.webUrl"
        target="_blank"
        rel="noopener noreferrer"
        >на {{ host }}</a
      >
    </div>
    <PullRequestPipelineStages
      v-if="open"
      :project-id="projectId"
      :id="pipeline.id"
      :host="host"
      @open-job="(job) => emit('openJob', job)"
    />
  </div>
</template>

<style scoped>
.pipeline-card {
  margin-top: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-2);
  font-size: var(--fs-xs);
}
.summary-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  min-width: 0;
}
.summary {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  flex: 1;
  text-align: left;
  color: var(--text-2);
}
.summary:hover {
  color: var(--text);
}
.chevron {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--faint);
  transition: transform var(--t-fast);
}
.chevron.open {
  transform: rotate(90deg);
}
.title {
  font-family: var(--mono);
  white-space: nowrap;
}
.state {
  color: var(--muted);
  white-space: nowrap;
}
.meta {
  color: var(--faint);
  font-size: var(--fs-2xs);
  white-space: nowrap;
}
.external {
  color: var(--muted);
  font-size: var(--fs-2xs);
  text-decoration: underline;
  white-space: nowrap;
}
</style>
