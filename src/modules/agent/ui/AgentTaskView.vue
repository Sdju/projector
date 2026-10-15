<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import { taskDuration, taskStatusLabel, type AgentTaskDetail } from "../lib/task-detail.ts";
import { loadSessionTurns } from "../api/client.ts";
import type { AgentBackendId, AgentTurn as Turn } from "../model/types.ts";
import AgentTurn from "./AgentTurn.vue";
import AgentCodeBlock from "./AgentCodeBlock.vue";
import AgentToolCall from "./AgentToolCall.vue";
import IconBack from "~icons/lucide/arrow-left";
import IconBot from "~icons/lucide/bot";
import IconTerminal from "~icons/lucide/terminal";
import IconTab from "~icons/lucide/square-arrow-out-up-right";

/** A task as a read-only chat: the assignment, what the subagent did and how it ended. */
const props = defineProps<{
  detail: AgentTaskDetail;
  embedded?: boolean;
  projectId: string;
  backend: AgentBackendId;
}>();
const emit = defineEmits<{ back: []; tab: [] }>();

const task = computed(() => props.detail.task);
const meta = computed(() =>
  [
    taskStatusLabel[task.value.status],
    task.value.subagent,
    task.value.background ? "в фоне" : "",
    task.value.tools ? `вызовов: ${task.value.tools}` : "",
    taskDuration(task.value.durationMs),
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
// A background task's own call only reports that it started: its result is not the outcome.
// The conversation of the subagent's own session, read from the agent; refreshed while it works.
const turns = ref<Turn[]>([]);
const loadError = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
// Tasks saved before the session was recorded: the launch result of the call names it.
const sessionId = computed(
  () =>
    task.value.session ?? /"sessionID"\s*:\s*"([^"]+)"/.exec(props.detail.call?.detail ?? "")?.[1],
);
async function load() {
  const session = sessionId.value;
  if (!session) return;
  const current = ++generation;
  try {
    const loaded = await loadSessionTurns(props.backend, props.projectId, session);
    if (current !== generation) return;
    turns.value = loaded;
    loadError.value = "";
  } catch (cause) {
    if (current === generation)
      loadError.value = cause instanceof Error ? cause.message : "Не удалось прочитать сессию";
  }
  if (current === generation && task.value.status === "running")
    timer = setTimeout(() => void load(), 3000);
}
watch(
  () => [sessionId.value, task.value.status],
  () => {
    clearTimeout(timer);
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation++;
  clearTimeout(timer);
});

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
      <p v-else-if="task.status !== 'running'" class="note">Без итога</p>
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
.body {
  display: grid;
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
