<script setup lang="ts">
import { computed, ref } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import { useElapsedClock } from "../lib/elapsed.ts";
import type { PlanItem } from "../lib/plan.ts";
import { taskElapsed, taskSummaryLine } from "../lib/task-detail.ts";
import { toolLabel } from "../lib/tool-labels.ts";
import { useAgentLens } from "../model/lens.ts";
import { useTaskTurns } from "../model/task-turns.ts";
import type {
  AgentBackendId,
  AgentSelection,
  AgentTask,
  AgentTurn,
  QueuedMessage,
} from "../model/types.ts";
import IconAlert from "~icons/lucide/circle-alert";
import IconBot from "~icons/lucide/bot";
import IconCheck from "~icons/lucide/check";
import IconRefresh from "~icons/lucide/refresh-cw";
import IconScanEye from "~icons/lucide/scan-eye";
import IconSquare from "~icons/lucide/square";
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
const transcript = useTaskTurns({
  backend: () => props.backend,
  projectId: () => props.projectId,
  session: () => props.task.session,
  running: () => props.task.status === "running",
});
const turns = computed((): AgentTurn[] => {
  if (transcript.turns.value.length) return transcript.turns.value;
  const prompt = props.task.prompt?.trim();
  return prompt ? [{ id: props.task.id, role: "user", text: prompt, tools: [] }] : [];
});
const phase = computed(() => {
  if (props.task.status !== "running") return "";
  return props.task.lastTool ? `выполняет ${toolLabel(props.task.lastTool)}` : "";
});
const lens = useAgentLens({
  turns,
  busy: computed(() => props.task.status === "running"),
  phase,
  queue: ref<QueuedMessage[]>([]),
  plan: ref<PlanItem[]>([]),
  selection: computed(() => props.selection ?? {}),
});
const lensNote = computed(
  () => lens.state.error || lens.state.text || (lens.state.busy ? "Смотрю, чем занят…" : ""),
);
async function toggleLens() {
  if (lens.state.open) {
    lens.close();
    transcript.stop();
    return;
  }
  await transcript.start();
  await lens.open();
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
.note.error {
  color: var(--err);
}
.lens-label {
  margin-right: 2px;
  color: var(--faint);
  font-size: var(--fs-2xs);
  letter-spacing: 0.02em;
  text-transform: uppercase;
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
