<script setup lang="ts">
import { computed, ref } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import { useElapsedClock } from "../lib/elapsed.ts";
import type { PlanItem } from "../lib/plan.ts";
import { taskElapsed, taskStatusLabel, type AgentTaskDetail } from "../lib/task-detail.ts";
import { toolLabel } from "../lib/tool-labels.ts";
import { useOptionalIdeCommands } from "../../ide/index.ts";
import { provideChatContext } from "../model/chat-link-actions.ts";
import { useAgentLens } from "../model/lens.ts";
import { useTaskTurns } from "../model/task-turns.ts";
import type { AgentBackendId, AgentSelection, QueuedMessage } from "../model/types.ts";
import AgentLensPanel from "./AgentLens.vue";
import AgentTurn from "./AgentTurn.vue";
import AgentCodeBlock from "./AgentCodeBlock.vue";
import AgentToolCall from "./AgentToolCall.vue";
import IconBack from "~icons/lucide/arrow-left";
import IconBot from "~icons/lucide/bot";
import IconScanEye from "~icons/lucide/scan-eye";
import IconTerminal from "~icons/lucide/terminal";
import IconTab from "~icons/lucide/square-arrow-out-up-right";

/** A task as a read-only chat: the assignment, what the subagent did and how it ended. */
const props = defineProps<{
  detail: AgentTaskDetail;
  embedded?: boolean;
  projectId: string;
  backend: AgentBackendId;
  selection?: AgentSelection;
}>();
const emit = defineEmits<{ back: []; tab: [] }>();

// Pictures read by the subagent resolve against the project, as in a chat answer.
const ide = useOptionalIdeCommands();
provideChatContext(props.projectId, ide?.api);

const task = computed(() => props.detail.task);
const now = useElapsedClock();
const meta = computed(() =>
  [
    taskStatusLabel[task.value.status],
    task.value.subagent,
    task.value.background ? "в фоне" : "",
    task.value.tools ? `вызовов: ${task.value.tools}` : "",
    taskElapsed(task.value, now.value),
  ]
    .filter(Boolean)
    .join(" · "),
);
// The agent's own wording; the call's input is the fallback (it may be an empty object).
const assignment = computed(() => {
  if (task.value.prompt) return task.value.prompt;
  const input = props.detail.call?.input?.trim() ?? "";
  return input && input !== "{}" ? input : "";
});
// Tasks saved before the session was recorded: the launch result of the call names it.
const sessionId = computed(
  () =>
    task.value.session ?? /"sessionID"\s*:\s*"([^"]+)"/.exec(props.detail.call?.detail ?? "")?.[1],
);
// The conversation of the subagent's own session, read from the agent; refreshed while it works.
const {
  turns,
  error: loadError,
  load,
} = useTaskTurns({
  backend: () => props.backend,
  projectId: () => props.projectId,
  session: () => sessionId.value,
  running: () => task.value.status === "running",
  auto: true,
});
const phase = computed(() => {
  if (task.value.status !== "running") return "";
  return task.value.lastTool ? `выполняет ${toolLabel(task.value.lastTool)}` : "";
});
const lens = useAgentLens({
  turns,
  busy: computed(() => task.value.status === "running"),
  phase,
  queue: ref<QueuedMessage[]>([]),
  plan: ref<PlanItem[]>([]),
  selection: computed(() => props.selection ?? {}),
});
async function toggleLens() {
  if (lens.state.open) {
    lens.close();
    return;
  }
  if (!turns.value.length) await load();
  await lens.open();
}

// A background task's own call only reports that it started: its result is not the outcome.
const outcome = computed(() => {
  const { call } = props.detail;
  if (task.value.status === "running") return "";
  if (task.value.summary) return task.value.summary;
  return call && !task.value.background ? call.detail : "";
});
</script>

<template>
  <section class="task-view" aria-label="Задача агента" @keydown.esc="emit('back')">
    <header class="head">
      <UiButton
        v-if="embedded"
        shape="icon"
        size="sm"
        title="Вернуться в чат (Esc)"
        aria-label="Вернуться в чат"
        @click="emit('back')"
      >
        <IconBack aria-hidden="true" />
      </UiButton>
      <component
        :is="task.kind === 'shell' ? IconTerminal : IconBot"
        class="kind"
        aria-hidden="true"
      />
      <div class="titles">
        <div class="title u-truncate" :title="task.title">{{ task.title || "Задача" }}</div>
        <div class="meta">
          <UiSpinner v-if="task.status === 'running'" />
          {{ meta }}
        </div>
      </div>
      <UiButton
        v-if="task.kind === 'agent'"
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
        v-if="embedded"
        shape="icon"
        size="sm"
        title="Открыть в новой вкладке"
        aria-label="Открыть в новой вкладке"
        @click="emit('tab')"
      >
        <IconTab aria-hidden="true" />
      </UiButton>
    </header>
    <div v-if="lens.state.open" class="task-lens">
      <AgentLensPanel :lens="lens" />
    </div>
    <div v-if="turns.length" class="body conversation" role="log" aria-label="Чат сабагента">
      <AgentTurn
        v-for="(turn, index) in turns"
        :key="turn.id"
        :turn="turn"
        :busy="task.status === 'running'"
        :last="index === turns.length - 1"
        :copied="false"
        readonly
      />
    </div>
    <div v-else class="body">
      <p v-if="loadError" class="note">{{ loadError }}</p>
      <template v-if="assignment">
        <div class="label">{{ task.kind === "shell" ? "Команда" : "Задание" }}</div>
        <AgentCodeBlock :text="assignment" />
      </template>
      <template v-if="detail.calls.length">
        <div class="label">Вызовы: {{ detail.calls.length }}</div>
        <AgentToolCall v-for="call in detail.calls" :key="call.id" :tool="call" />
      </template>
      <template v-else-if="task.log?.length">
        <div class="label">Ход работы</div>
        <ol class="log">
          <li v-for="(line, index) in task.log" :key="index">{{ line }}</li>
        </ol>
      </template>
      <p v-else-if="task.status === 'running'" class="note">
        <UiSpinner /> Агент работает, подробностей пока нет
      </p>
      <template v-if="outcome">
        <div class="label">Итог</div>
        <AgentCodeBlock :text="outcome" />
      </template>
      <p v-else-if="task.status !== 'running'" class="note">Агент не сообщил итог</p>
    </div>
  </section>
</template>

<style scoped>
.task-view {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.head {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--line);
}
.kind {
  color: var(--faint);
}
.titles {
  display: grid;
  min-width: 0;
  flex: 1;
}
.title {
  color: var(--text);
  font-size: var(--fs-sm);
}
.meta {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
  color: var(--faint);
}
.task-lens {
  padding: var(--sp-1) var(--sp-3);
  border-bottom: 1px solid var(--line);
}
.body {
  display: grid;
  /* A scrollable result block must keep its content height instead of collapsing into a strip. */
  grid-auto-rows: max-content;
  align-content: start;
  gap: var(--sp-1);
  width: min(100%, var(--chat-width, 680px));
  margin: 0 auto;
  padding: var(--sp-3);
  overflow: auto;
  box-sizing: border-box;
  flex: 1;
}
.label {
  margin-top: var(--sp-2);
  color: var(--faint);
}
.log {
  display: grid;
  gap: 2px;
  margin: 0;
  padding-left: var(--sp-4);
  color: var(--muted);
}
.log li:last-child {
  color: var(--text);
}
.note {
  margin: 0;
  color: var(--faint);
}
</style>
