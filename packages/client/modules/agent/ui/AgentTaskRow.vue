<script setup lang="ts">
import { computed } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { useElapsedClock } from "../lib/elapsed.ts";
import { taskElapsed, taskSummaryLine } from "../lib/task-detail.ts";
import { toolLabel } from "../lib/tool-labels.ts";
import { useTaskLens } from "../model/task-lens.ts";
import type { AgentBackendId, AgentSelection, AgentTask } from "../model/types.ts";
import AgentStatusIcon from "./AgentStatusIcon.vue";
import IconBot from "~icons/lucide/bot";
import IconRefresh from "~icons/lucide/refresh-cw";
import IconScanEye from "~icons/lucide/scan-eye";
import IconTerminal from "~icons/lucide/terminal";
import IconTab from "~icons/lucide/square-arrow-out-up-right";

/** One subagent or background command in the task list: open it to read, or in a tab. */
const props = defineProps<{
  task: AgentTask;
  current?: boolean;
  projectId?: string;
  backend?: AgentBackendId;
  selection?: AgentSelection;
}>();
const emit = defineEmits<{ view: [id: string]; tab: [id: string] }>();
const now = useElapsedClock();
const duration = computed(() => taskElapsed(props.task, now.value));

function note() {
  const task = props.task;
  const parts = [
    task.subagent,
    task.tools ? `вызовов: ${task.tools}` : "",
    duration.value,
    task.status === "running" && task.lastTool
      ? toolLabel(task.lastTool)
      : taskSummaryLine(task.summary),
  ];
  return parts.filter(Boolean).join(" · ");
}

// Lens of one subagent: the row stays closed until asked, then reads the task's own session.
const { lens, lensNote, toggleLens } = useTaskLens({
  backend: () => props.backend,
  projectId: () => props.projectId,
  session: () => props.task.session,
  running: () => props.task.status === "running",
  lastTool: () => props.task.lastTool,
  selection: () => props.selection,
  fallback: () => {
    const prompt = props.task.prompt?.trim();
    return prompt ? { id: props.task.id, text: prompt } : undefined;
  },
  startOnOpen: true,
  stopOnClose: true,
});
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
      <AgentStatusIcon :status="task.status" />
      <component
        :is="task.kind === 'shell' ? IconTerminal : IconBot"
        class="faint-icon"
        aria-hidden="true"
      />
      <span class="name u-truncate">{{ task.title || "Задача" }}</span>
      <span
        v-if="lens.state.open"
        class="note u-truncate"
        :class="{ error: lens.state.error }"
        :title="lensNote"
      >
        <span class="lens-label">Lens</span>
        {{ lensNote }}
      </span>
      <span v-else class="note u-truncate">{{ note() }}</span>
    </button>
    <template v-if="task.kind === 'agent'">
      <UiButton
        shape="icon"
        size="sm"
        :active="lens.state.open"
        :aria-pressed="lens.state.open"
        :title="lens.state.open ? 'Скрыть Lens' : 'Lens: чем занимается сабагент'"
        :aria-label="lens.state.open ? 'Скрыть Lens' : 'Показать Lens'"
        @click="toggleLens"
      >
        <IconScanEye aria-hidden="true" />
      </UiButton>
      <UiButton
        v-if="lens.state.open"
        shape="icon"
        size="sm"
        :disabled="lens.state.busy"
        title="Обновить Lens"
        aria-label="Обновить Lens"
        @click="lens.refresh()"
      >
        <IconRefresh aria-hidden="true" />
      </UiButton>
    </template>
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
  border-radius: var(--r-md);
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
.lens-label {
  margin-right: 2px;
  color: var(--faint);
  font-size: var(--fs-2xs);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.faint-icon {
  color: var(--faint);
}
</style>
