<script setup lang="ts">
import { computed, ref } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiDisclosureSummary from "../../../common/ui/UiDisclosureSummary.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import { taskDuration } from "../lib/task-detail.ts";
import { toolLabel } from "../lib/tool-labels.ts";
import type { AgentTask } from "../model/types.ts";
import IconAlert from "~icons/lucide/circle-alert";
import IconBot from "~icons/lucide/bot";
import IconCheck from "~icons/lucide/check";
import IconChevron from "~icons/lucide/chevron-right";
import IconSquare from "~icons/lucide/square";
import IconTerminal from "~icons/lucide/terminal";
import IconTab from "~icons/lucide/square-arrow-out-up-right";

/** Subagents and background commands as a strip above the input: open one to read, or in a tab. */
const props = defineProps<{ tasks: AgentTask[]; viewing?: string }>();
const emit = defineEmits<{ view: [id: string]; tab: [id: string] }>();

const running = computed(() => props.tasks.filter((task) => task.status === "running").length);
const title = computed(() =>
  running.value ? `Выполняется в фоне: ${running.value}` : `Задачи: ${props.tasks.length}`,
);
// Opened while something runs, until the user folds it by hand.
const folded = ref<boolean>();
const open = computed(() => (folded.value === undefined ? running.value > 0 : !folded.value));

function note(task: AgentTask) {
  const parts = [
    task.subagent,
    task.tools ? `вызовов: ${task.tools}` : "",
    taskDuration(task.durationMs),
    task.status === "running" && task.lastTool ? toolLabel(task.lastTool) : task.summary,
  ];
  return parts.filter(Boolean).join(" · ");
}
</script>

<template>
  <details
    v-if="tasks.length"
    class="task-bar"
    :open="open"
    @toggle="folded = !($event.target as HTMLDetailsElement).open"
  >
    <UiDisclosureSummary variant="fit" class="bar-summary">
      <UiSpinner v-if="running" />
      <IconCheck v-else class="done-icon" aria-hidden="true" />
      <span>{{ title }}</span>
      <IconChevron class="chevron" aria-hidden="true" />
    </UiDisclosureSummary>
    <ul class="list">
      <li v-for="task in tasks" :key="task.id" :class="{ current: viewing === task.id }">
        <button
          type="button"
          class="row"
          :title="`Открыть чат: ${task.title}`"
          :aria-pressed="viewing === task.id"
          @click="emit('view', task.id)"
        >
          <UiSpinner v-if="task.status === 'running'" />
          <IconAlert v-else-if="task.status === 'error'" class="error-icon" aria-hidden="true" />
          <IconSquare v-else-if="task.status === 'stopped'" class="faint-icon" aria-hidden="true" />
          <IconCheck v-else class="done-icon" aria-hidden="true" />
          <component
            :is="task.kind === 'shell' ? IconTerminal : IconBot"
            class="faint-icon"
            aria-hidden="true"
          />
          <span class="name u-truncate">{{ task.title || "Задача" }}</span>
          <span class="note u-truncate">{{ note(task) }}</span>
        </button>
        <UiButton
          shape="icon"
          size="sm"
          title="Открыть в новой вкладке"
          aria-label="Открыть в новой вкладке"
          @click="emit('tab', task.id)"
        >
          <IconTab aria-hidden="true" />
        </UiButton>
      </li>
    </ul>
  </details>
</template>

<style scoped>
.task-bar {
  margin: 0 0 var(--sp-2);
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.chevron {
  width: 12px;
  transition: transform var(--t-fast);
}
.task-bar[open] > summary .chevron {
  transform: rotate(90deg);
}
.list {
  display: grid;
  gap: 2px;
  margin: var(--sp-1) 0 0;
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
  border-radius: var(--radius);
}
li.current {
  background: var(--hover);
}
.row {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  min-width: 0;
  flex: 1;
  padding: 3px var(--sp-1);
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.row:hover .name {
  text-decoration: underline;
}
.name {
  min-width: 0;
  flex: 0 1 auto;
  color: var(--text);
}
.note {
  min-width: 0;
  flex: 1;
  color: var(--faint);
}
.done-icon {
  color: var(--run);
}
.error-icon {
  color: var(--err);
}
.faint-icon {
  color: var(--faint);
}
@media (prefers-reduced-motion: reduce) {
  .chevron {
    transition: none;
  }
}
</style>
