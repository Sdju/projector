<script setup lang="ts">
import UiScrollArea from "../../../../../common/ui/UiScrollArea.vue";
import UiEmpty from "../../../../../common/ui/UiEmpty.vue";
import UiMessage from "../../../../../common/ui/UiMessage.vue";
import type { Pipeline } from "../../../../../../core/modules/workspace/index.ts";
import { PIPELINE_FILTERS, usePipelines } from "../lib/pipelines.ts";
import { usePipelinesPanel } from "../lib/pipeline-panel.ts";
import PipelineRow from "./PipelineRow.vue";
import IconChevronRight from "~icons/lucide/chevron-right";

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
  <UiScrollArea class="side-content pipeline-panel">
    <button
      class="block-toggle"
      type="button"
      :aria-expanded="open"
      data-command="ide.pipelines.block.toggle"
      @click="run('block.toggle')"
    >
      <IconChevronRight class="chevron" :class="{ open }" aria-hidden="true" />
      <h3>
        Pipelines
        <span v-if="list.items.value.length" class="count">{{ list.items.value.length }}</span>
      </h3>
    </button>
    <UiScrollArea v-show="open" class="block-body">
      <div class="state-filter" role="group" aria-label="Статус: pipelines">
        <button
          v-for="option in PIPELINE_FILTERS"
          :key="option.value"
          type="button"
          :class="{ active: list.status.value === option.value }"
          :aria-pressed="list.status.value === option.value"
          @click="run('filter', { status: option.value })"
        >
          {{ option.label }}
        </button>
      </div>
      <UiMessage v-if="list.loading.value" variant="note" tone="muted" role="status"
        >загрузка: pipelines…</UiMessage
      >
      <UiMessage v-else-if="list.error.value" variant="note" tone="danger" role="alert">{{
        list.error.value
      }}</UiMessage>
      <UiEmpty v-else-if="!list.items.value.length" density="compact" align="start"
        >Нет: pipelines</UiEmpty
      >
      <ul v-else class="pipeline-list">
        <li v-for="pipeline in list.items.value" :key="pipeline.id">
          <PipelineRow
            :pipeline="pipeline"
            @click="openPipeline(pipeline)"
            @dblclick="openPipeline(pipeline, true)"
          />
        </li>
      </ul>
      <button
        v-if="list.next.value !== null && !list.loading.value"
        type="button"
        class="more"
        :disabled="list.loadingMore.value"
        @click="run('more')"
      >
        {{ list.loadingMore.value ? "загрузка…" : "Показать ещё" }}
      </button>
    </UiScrollArea>
  </UiScrollArea>
</template>

<style scoped>
.pipeline-panel {
  display: flex;
  flex-direction: column;
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
.pipeline-list {
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
