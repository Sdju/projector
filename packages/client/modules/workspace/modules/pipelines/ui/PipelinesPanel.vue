<script setup lang="ts">
import UiListSection from "../../../../../common/ui/UiListSection.vue";
import type { Pipeline } from "@projector/core/modules/workspace/index.ts";
import { PIPELINE_FILTERS, usePipelines } from "../lib/pipelines.ts";
import { usePipelinesPanel } from "../lib/pipeline-panel.ts";
import PipelineRow from "./PipelineRow.vue";

/** Sidebar pipeline section: status filter, list and the next pages of the project history. */
const props = defineProps<{ projectId: string; active: boolean }>();
const emit = defineEmits<{
  open: [pipeline: { id: number; title?: string }, pinned?: boolean];
}>();
const list = usePipelines(() => props.projectId);
const { commands, open } = usePipelinesPanel({
  projectId: () => props.projectId,
  active: () => props.active,
  list,
  open: (pipeline, pinned) => emit("open", pipeline, pinned),
});
const run = (action: string, args?: unknown) => commands.run(`ide.pipelines.${action}`, args);
const openPipeline = (pipeline: Pipeline, pinned = false) =>
  run("open", { id: pipeline.id, title: pipeline.name || pipeline.ref, pinned });
defineExpose({ refresh: () => list.load() });
</script>

<template>
  <UiListSection
    class="pipeline-panel"
    title="Pipelines"
    :count="list.items.value.length"
    :open="open"
    :filters="PIPELINE_FILTERS"
    :current="list.status.value"
    :loading="list.loading.value"
    :loading-more="list.loadingMore.value"
    :error="list.error.value"
    :has-more="list.next.value !== null"
    noun="pipelines"
    filter-label="Статус"
    toggle-command="ide.pipelines.block.toggle"
    @toggle="run('block.toggle')"
    @filter="run('filter', { status: $event })"
    @more="run('more')"
  >
    <li v-for="pipeline in list.items.value" :key="pipeline.id">
      <PipelineRow
        :pipeline="pipeline"
        @click="openPipeline(pipeline)"
        @dblclick="openPipeline(pipeline, true)"
      />
    </li>
  </UiListSection>
</template>
