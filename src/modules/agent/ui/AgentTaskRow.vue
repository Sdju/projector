<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import { taskDuration } from "../lib/task-detail.ts";
import { toolLabel } from "../lib/tool-labels.ts";
import type { AgentTask } from "../model/types.ts";
import IconAlert from "~icons/lucide/circle-alert";
import IconBot from "~icons/lucide/bot";
import IconCheck from "~icons/lucide/check";
import IconSquare from "~icons/lucide/square";
import IconTerminal from "~icons/lucide/terminal";
import IconTab from "~icons/lucide/square-arrow-out-up-right";

/** One subagent or background command in the task list: open it to read, or in a tab. */
const props = defineProps<{ task: AgentTask; current?: boolean }>();
const emit = defineEmits<{ view: [id: string]; tab: [id: string] }>();

function note() {
  const task = props.task;
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
  <li :class="{ current }">
    <button
      type="button"
      class="row"
      :title="`Открыть чат: ${task.title}`"
      :aria-pressed="current"
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
      <span class="note u-truncate">{{ note() }}</span>
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
</template>

<style scoped>
svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
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
</style>
