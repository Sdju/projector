<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useIdeCommands } from "../../ide/index.ts";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { agentCommandHandler } from "../model/commands.ts";
import { agentLabel } from "../model/modes.ts";
import { useAgent } from "../model/session.ts";
import { readoutLines, useTabReadout } from "../../../common/utilities/tab-readout.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import AgentWelcome from "./AgentWelcome.vue";
import AgentTurn from "./AgentTurn.vue";
import AgentComposer from "./AgentComposer.vue";
import AgentPermissions from "./AgentPermissions.vue";
import AgentControls from "./AgentControls.vue";
import AgentSessions from "./AgentSessions.vue";
import type { AgentBackendId, AgentControl, AgentPermissionMode } from "../model/types.ts";
import IconSquarePen from "~icons/lucide/square-pen";

const props = withDefaults(
  defineProps<{ projectId: string; backend?: AgentBackendId; chatId?: string }>(),
  { backend: "projector", chatId: undefined },
);
/** External agents are plain coding agents: no Projector tools, their own approvals. */
const plain = computed(() => props.backend !== "projector");
const claude = computed(() => props.backend === "claude-code");
const agentName = computed(() => agentLabel(props.backend));
const { api } = useIdeCommands();
const {
  turns,
  draft,
  busy,
  error,
  phase,
  permissions,
  permissionMode,
  controls,
  sessions,
  sessionsLoading,
  sessionsError,
  loadControls,
  setControl,
  loadSessions,
  resumeSession,
  send,
  clear,
  stop,
  attach,
  release,
  decide,
} = useAgent(props.projectId, plain.value ? undefined : agentCommandHandler(api, props.projectId), {
  backend: props.backend,
  chatId: props.chatId,
});
onMounted(() => void loadControls());
const PERMISSION_CONTROL = "permission-mode";
const permissionOptions: { value: AgentPermissionMode; name: string; description: string }[] = [
  { value: "default", name: "Спрашивать", description: "Запрос перед правками и командами" },
  {
    value: "acceptEdits",
    name: "Правки без вопросов",
    description: "Файлы меняются сразу, команды — по запросу",
  },
  {
    value: "bypassPermissions",
    name: "Всё без вопросов",
    description: "Без запросов разрешений",
  },
];
/** Параметры из бэкенда плюс режим разрешений Claude Code: всё в одном острове. */
const allControls = computed<AgentControl[]>(() => [
  ...controls.value,
  ...(claude.value
    ? [
        {
          id: PERMISSION_CONTROL,
          category: "mode" as const,
          name: "Разрешения",
          description: "Когда агент спрашивает подтверждение",
          current: permissionMode.value,
          options: permissionOptions,
        },
      ]
    : []),
]);
function changeControl(id: string, value: string) {
  if (id === PERMISSION_CONTROL) permissionMode.value = value as AgentPermissionMode;
  else void setControl(id, value);
}
const activeSession = computed(
  () => turns.value.findLast((turn) => turn.role === "assistant")?.session?.id,
);
const commands = useCommandScope(
  `agent-chat:${props.backend}:${props.chatId ?? props.projectId}`,
  () => ({
    surface: "agent-chat",
    backend: props.backend,
    projectId: props.projectId,
  }),
);
if (plain.value) {
  const idle = () => !busy.value;
  commands.scope.registerCommand({
    id: "ide.agent.controls.menu.toggle",
    title: `Открыть или закрыть параметры агента ${agentName.value}`,
    description:
      "Показывает остров над полем ввода: модель, усилие, режим и разрешения с пояснениями.",
    enabled: idle,
    run: () => controlsMenu.value?.toggle(),
  });
  commands.scope.registerCommand({
    id: "ide.agent.controls.list",
    title: `Параметры агента ${agentName.value}: модель, усилие, режим`,
    description:
      "Возвращает настройки открытого чата внешнего агента (модель, усилие рассуждений, режим) с текущими значениями и допустимыми вариантами.",
    run: () =>
      controls.value.map((control) => ({
        id: control.id,
        name: control.name,
        current: control.current,
        options: control.options.map((option) => option.value),
      })),
  });
  commands.scope.registerCommand({
    id: "ide.agent.control.set",
    title: `Выбрать модель, усилие или режим агента ${agentName.value}`,
    description:
      "Задаёт настройку открытого чата внешнего агента. Действует со следующего сообщения и запоминается как выбор по умолчанию для этого агента.",
    arguments: {
      id: "Идентификатор настройки из ide.agent.controls.list (например model)",
      value: "Одно из допустимых значений настройки",
    },
    enabled: idle,
    run: async (args) => {
      const { id, value } = commandArgs(args);
      if (typeof id !== "string" || typeof value !== "string")
        throw new Error("Укажите id и value настройки");
      await setControl(id, value);
      return { id, value };
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.sessions.list",
    title: `Прошлые сессии агента ${agentName.value}`,
    description:
      "Возвращает прошлые сессии этого агента в папке проекта, от новых к старым: идентификатор, название и время.",
    run: () => loadSessions(),
  });
  commands.scope.registerCommand({
    id: "ide.agent.session.resume",
    title: `Продолжить прошлую сессию агента ${agentName.value}`,
    description:
      "Заменяет содержимое открытого чата сообщениями выбранной прошлой сессии; следующее сообщение продолжит её. Идентификаторы даёт ide.agent.sessions.list.",
    arguments: { sessionId: "Идентификатор сессии" },
    enabled: idle,
    run: async (args) => {
      const { sessionId } = commandArgs(args);
      if (typeof sessionId !== "string") throw new Error("Укажите sessionId");
      await resumeSession(sessionId);
      return { sessionId };
    },
  });
}
attach();
// Что штатный агент видит в чате: статус, последний ответ и чипы инструментов.
useTabReadout(() => {
  const last = turns.value.at(-1);
  const answer = turns.value
    .findLast((turn) => turn.role === "assistant")
    ?.text.trim()
    .slice(0, 2000);
  const chips = last?.tools.map((tool) => `${tool.name} — ${tool.status}`).join("; ");
  return {
    note: `Чат агента ${agentName.value}`,
    text: readoutLines(
      `Бэкенд: ${props.backend ?? "projector"}`,
      busy.value ? `Состояние: Работает (${phase.value})` : "Состояние: Готов",
      error.value ? `Ошибка: ${error.value}` : "",
      ...controls.value.map(
        (control) =>
          `${control.name}: ${control.options.find((item) => item.value === control.current)?.name ?? control.current}`,
      ),
      `Сообщений: ${turns.value.length}`,
      answer ? `Последний ответ:\n${answer}` : "",
      chips ? `Инструменты: ${chips}` : "",
    ),
  };
});
const log = ref<HTMLElement>();
const controlsMenu = ref<InstanceType<typeof AgentControls>>();
const composer = ref<InstanceType<typeof AgentComposer>>();
const away = ref(false);
const copied = ref("");
const copyError = ref("");
let copyTimer: ReturnType<typeof setTimeout> | undefined;
let observer: ResizeObserver | undefined;
// Content growth never changes scrollTop, so only a decrease is a user scrolling up.
let lastTop = 0;
function trackScroll() {
  const element = log.value;
  if (!element || !element.clientHeight) return;
  const top = element.scrollTop;
  if (element.scrollHeight - top - element.clientHeight <= 72) away.value = false;
  else if (top < lastTop) away.value = true;
  lastTop = top;
}
let frame = 0;
function pin() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const element = log.value;
    if (!element || away.value) return;
    element.scrollTop = turns.value.length ? element.scrollHeight : 0;
    lastTop = element.scrollTop;
  });
}
async function toBottom() {
  away.value = false;
  await nextTick();
  pin();
}
async function submit() {
  if (busy.value || !draft.value.trim()) return;
  void toBottom();
  await send();
  composer.value?.focus();
}
async function suggest(text: string) {
  draft.value = text;
  await nextTick();
  composer.value?.resize();
  composer.value?.focus();
}
async function newChat() {
  await clear();
  away.value = false;
  composer.value?.focus();
}
async function copyMessage(id: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = id;
    copyError.value = "";
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = "";
    }, 2000);
  } catch {
    copyError.value = "Не удалось скопировать ответ";
  }
}
watch(
  () => [
    turns.value.length,
    turns.value.at(-1)?.text,
    permissions.value.length,
    turns.value
      .at(-1)
      ?.tools.map((tool) => `${tool.id}:${tool.status}:${tool.detail}`)
      .join("|"),
  ],
  async () => {
    pin();
    await nextTick();
    observeContent();
  },
);
onMounted(() => {
  composer.value?.resize();
  observer = new ResizeObserver(() => {
    pin();
    composer.value?.resize();
  });
  if (log.value) observer.observe(log.value);
  observeContent();
});
function observeContent() {
  const content = log.value?.firstElementChild;
  if (!observer || !content || content === observed) return;
  if (observed) observer.unobserve(observed);
  observer.observe(content);
  observed = content;
}
let observed: Element | undefined;
onBeforeUnmount(() => {
  release();
  observer?.disconnect();
  cancelAnimationFrame(frame);
  clearTimeout(copyTimer);
});
</script>

<template>
  <section class="agent-chat" aria-label="Чат с агентом">
    <div class="chat-tools">
      <AgentSessions
        v-if="plain"
        :sessions="sessions"
        :loading="sessionsLoading"
        :error="sessionsError"
        :disabled="busy"
        :active="activeSession"
        @open="loadSessions"
        @pick="(id) => void resumeSession(id).catch(() => {})"
      />
      <UiButton
        v-if="turns.length"
        icon
        size="sm"
        title="Новый чат"
        aria-label="Новый чат"
        :disabled="busy"
        @click="newChat"
      >
        <IconSquarePen aria-hidden="true" />
      </UiButton>
    </div>
    <div ref="log" class="chat-log" @scroll.passive="trackScroll">
      <AgentWelcome
        v-if="!turns.length"
        :plain="plain"
        :agent-name="agentName"
        @suggest="suggest"
      />
      <div
        v-else
        class="conversation"
        role="log"
        aria-label="Сообщения"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <AgentTurn
          v-for="(turn, index) in turns"
          :key="turn.id"
          :turn="turn"
          :busy="busy"
          :last="index === turns.length - 1"
          :copied="copied === turn.id"
          @copy="copyMessage"
        />
      </div>
    </div>
    <AgentPermissions class="permission-dock" :permissions="permissions" @decide="decide" />
    <AgentComposer
      ref="composer"
      v-model="draft"
      :busy="busy"
      :away="away"
      :error="error || copyError"
      :copied="!!copied"
      @submit="submit"
      @stop="stop"
      @latest="toBottom"
    >
      <template v-if="plain" #controls>
        <AgentControls
          ref="controlsMenu"
          :controls="allControls"
          :disabled="busy"
          @change="changeControl"
        />
      </template>
    </AgentComposer>
  </section>
</template>
<style scoped>
.agent-chat {
  --chat-width: 680px;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--bg);
  container-type: inline-size;
  position: relative;
}
.chat-tools {
  position: absolute;
  top: var(--sp-2);
  right: var(--sp-3);
  z-index: var(--z-sticky);
  display: flex;
  gap: var(--sp-1);
}
.chat-log {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overflow-anchor: none;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
  padding: var(--sp-6) var(--sp-5) var(--sp-4);
}
.permission-dock {
  width: 100%;
  max-width: calc(var(--chat-width) + 56px);
  margin: 0 auto;
  padding: 0 var(--sp-5);
  flex-shrink: 0;
}
.conversation {
  width: 100%;
  max-width: var(--chat-width);
  margin: auto;
}
@container (max-width: 500px) {
  .chat-log {
    padding: var(--sp-5) var(--sp-4);
  }
}
@media (prefers-reduced-motion: reduce) {
  .agent-chat *,
  .agent-chat *::before {
    animation: none;
    transition: none;
  }
}
</style>
