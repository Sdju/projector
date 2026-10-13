<script setup lang="ts">
import { computed } from "vue";
import UiDisclosureSummary from "../../../common/ui/UiDisclosureSummary.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import { toolLabel } from "../lib/tool-labels.ts";
import type { AgentTask } from "../model/types.ts";
import IconAlert from "~icons/lucide/circle-alert";
import IconBot from "~icons/lucide/bot";
import IconCheck from "~icons/lucide/check";
import IconChevron from "~icons/lucide/chevron-right";
import IconSquare from "~icons/lucide/square";
import IconTerminal from "~icons/lucide/terminal";

const props = defineProps<{ tasks: AgentTask[] }>();
const running = computed(() => props.tasks.filter((task) => task.status === "running").length);
const title = computed(() =>
  running.value ? `Выполняется в фоне: ${running.value}` : `Задачи: ${props.tasks.length}`,
);

function duration(ms?: number) {
  if (!ms) return "";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
}
function meta(task: AgentTask) {
  return [
    task.subagent,
    task.background ? "в фоне" : "",
    task.tools ? `вызовов: ${task.tools}` : "",
    duration(task.durationMs),
  ]
    .filter(Boolean)
    .join(" · ");
}
function note(task: AgentTask) {
  if (task.summary) return task.summary;
  return task.status === "running" && task.lastTool ? toolLabel(task.lastTool) : "";
}
</script>

<template>
  <details class="tasks" :class="{ working: running }" :open="running > 0 || undefined">
    <UiDisclosureSummary variant="fit" class="tasks-summary">
      <UiSpinner v-if="running" />
      <IconCheck v-else class="done-icon" aria-hidden="true" />
      <span>{{ title }}</span>
      <IconChevron class="tasks-chevron" aria-hidden="true" />
    </UiDisclosureSummary>
    <ul class="tasks-list">
      <li v-for="task in tasks" :key="task.id" class="task" :class="task.status">
        <UiSpinner v-if="task.status === 'running'" />
        <IconAlert v-else-if="task.status === 'error'" class="error-icon" aria-hidden="true" />
        <IconSquare v-else-if="task.status === 'stopped'" class="stopped-icon" aria-hidden="true" />
        <IconCheck v-else class="done-icon" aria-hidden="true" />
        <div class="task-body">
          <div class="task-head">
            <component
              :is="task.kind === 'shell' ? IconTerminal : IconBot"
              class="kind-icon"
              aria-hidden="true"
            />
            <span class="task-title" :title="task.title">{{ task.title || "Задача" }}</span>
          </div>
          <div v-if="meta(task)" class="task-meta">{{ meta(task) }}</div>
          <div v-if="note(task)" class="task-note" :title="note(task)">{{ note(task) }}</div>
        </div>
      </li>
    </ul>
  </details>
</template>

<style scoped>
.tasks {
  margin: 0 0 var(--sp-3);
  max-width: 100%;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.tasks-chevron {
  width: 12px;
  transition: transform var(--t-fast);
}
.tasks[open] > summary .tasks-chevron {
  transform: rotate(90deg);
}
.tasks-list {
  display: grid;
  gap: var(--sp-2);
  margin: var(--sp-1) 0 0;
  padding: 0 0 0 var(--sp-3);
  border-left: 1px solid var(--line);
  list-style: none;
}
.task {
  display: flex;
  gap: var(--sp-2);
  align-items: flex-start;
  min-width: 0;
}
.task > svg,
.task > :deep(.ui-spinner) {
  margin-top: 2px;
}
.task-body {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.task-head {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
  min-width: 0;
  color: var(--text);
}
.kind-icon {
  color: var(--faint);
}
.task-title,
.task-note {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-meta,
.task-note {
  color: var(--faint);
}
.done-icon {
  color: var(--run);
}
.error-icon {
  color: var(--err);
}
.stopped-icon {
  color: var(--faint);
}
@media (prefers-reduced-motion: reduce) {
  .tasks-chevron {
    transition: none;
  }
}
</style>
