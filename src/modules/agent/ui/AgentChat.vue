<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useIdeCommands } from "../../ide/index.ts";
import { useProjects } from "../../catalog/index.ts";
import { agentCommandHandler } from "../model/commands.ts";
import { useAgent } from "../model/session.ts";
import AgentMessage from "./AgentMessage.vue";
import AgentActivity from "./AgentActivity.vue";
import IconBot from "~icons/lucide/bot";
import IconArrowUp from "~icons/lucide/arrow-up";
import IconArrowDown from "~icons/lucide/arrow-down";
import IconSquare from "~icons/lucide/square";
import IconSquarePen from "~icons/lucide/square-pen";
import IconCopy from "~icons/lucide/copy";
import IconCheck from "~icons/lucide/check";
import IconFolder from "~icons/lucide/folder";
import IconFiles from "~icons/lucide/files";
import IconGit from "~icons/lucide/git-branch";
import IconTerminal from "~icons/lucide/terminal";
import IconCornerDownLeft from "~icons/lucide/corner-down-left";
import IconAlert from "~icons/lucide/circle-alert";

const props = defineProps<{ projectId: string }>();
const { api } = useIdeCommands();
const { projects } = useProjects();
const projectName = computed(
  () => projects.value.find((p) => p.id === props.projectId)?.name ?? "Текущий проект",
);
const { turns, draft, busy, error, phase, send, clear, stop } = useAgent(
  props.projectId,
  agentCommandHandler(api, props.projectId),
);
const log = ref<HTMLElement>();
const input = ref<HTMLTextAreaElement>();
const away = ref(false);
const copied = ref("");
const copyError = ref("");
let copyTimer: ReturnType<typeof setTimeout> | undefined;
let observer: ResizeObserver | undefined;
const suggestions = [
  {
    title: "Разобраться в проекте",
    caption: "Структура и основные файлы",
    text: "Посмотри структуру проекта и расскажи, где находятся основные части приложения.",
    icon: IconFiles,
  },
  {
    title: "Посмотреть изменения",
    caption: "Что изменилось в Git",
    text: "Посмотри изменения в Git и кратко объясни, что изменилось. Ничего не меняй.",
    icon: IconGit,
  },
  {
    title: "Найти команду",
    caption: "Действия внутри Projector",
    text: "Какие команды Projector доступны для этого проекта?",
    icon: IconTerminal,
  },
];
function resizeInput() {
  if (!input.value) return;
  input.value.style.height = "auto";
  input.value.style.height = `${Math.min(input.value.scrollHeight, 180)}px`;
}
function trackScroll() {
  const element = log.value;
  if (element && element.clientHeight)
    away.value = element.scrollHeight - element.scrollTop - element.clientHeight > 72;
}
async function toBottom() {
  away.value = false;
  await nextTick();
  log.value?.scrollTo({ top: turns.value.length ? log.value.scrollHeight : 0 });
}
async function submit() {
  if (busy.value || !draft.value.trim()) return;
  void toBottom();
  await send();
  input.value?.focus();
}
async function suggest(text: string) {
  draft.value = text;
  await nextTick();
  resizeInput();
  input.value?.focus();
}
async function newChat() {
  await clear();
  away.value = false;
  input.value?.focus();
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
watch(draft, async () => {
  await nextTick();
  resizeInput();
});
watch(
  () => [
    turns.value.length,
    turns.value.at(-1)?.text,
    turns.value
      .at(-1)
      ?.tools.map((tool) => `${tool.id}:${tool.status}:${tool.detail}`)
      .join("|"),
  ],
  () => {
    if (!away.value) void toBottom();
  },
);
onMounted(() => {
  resizeInput();
  observer = new ResizeObserver(() => {
    if (!away.value) void toBottom();
    resizeInput();
  });
  if (log.value) observer.observe(log.value);
});
onBeforeUnmount(() => {
  stop();
  observer?.disconnect();
  clearTimeout(copyTimer);
});
function keydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !event.repeat) {
    event.preventDefault();
    void submit();
  }
}
</script>

<template>
  <section class="agent-chat" aria-label="Чат с агентом">
    <header class="chat-header">
      <div class="identity">
        <span class="header-mark"><IconBot aria-hidden="true" /></span
        ><span class="agent-name">Projector</span>
      </div>
      <span class="project-context" :title="projectName"
        ><IconFolder aria-hidden="true" />{{ projectName }}</span
      >
      <div class="header-actions">
        <span class="agent-status" :class="{ busy }" role="status" :title="phase"
          ><i aria-hidden="true" />{{ busy ? "Работает" : "Готов" }}</span
        >
        <button
          class="icon-button"
          type="button"
          title="Новый чат"
          aria-label="Новый чат"
          :disabled="busy || !turns.length"
          @click="newChat"
        >
          <IconSquarePen aria-hidden="true" />
        </button>
      </div>
    </header>
    <div ref="log" class="chat-log" @scroll.passive="trackScroll">
      <div v-if="!turns.length" class="welcome">
        <div class="welcome-mark"><IconBot aria-hidden="true" /></div>
        <h1>С чего начнём?</h1>
        <p>Помогу разобраться в проекте<br />и выполнить нужные действия.</p>
        <div class="suggestions">
          <button
            v-for="suggestion in suggestions"
            :key="suggestion.title"
            type="button"
            @click="suggest(suggestion.text)"
          >
            <component :is="suggestion.icon" class="suggestion-icon" aria-hidden="true" />
            <span
              ><strong>{{ suggestion.title }}</strong
              ><small>{{ suggestion.caption }}</small></span
            >
            <IconCornerDownLeft class="suggestion-arrow" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        v-else
        class="conversation"
        role="log"
        aria-label="Сообщения"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <article v-for="(turn, index) in turns" :key="turn.id" class="turn" :class="turn.role">
          <template v-if="turn.role === 'user'">
            <span class="user-label">Вы</span>
            <p class="user-message">{{ turn.text }}</p>
          </template>
          <template v-else>
            <div class="assistant-heading">
              <span class="avatar"><IconBot aria-hidden="true" /></span>
              <span class="sender">Projector</span>
              <button
                v-if="turn.text"
                type="button"
                class="icon-button copy-button"
                :class="{ copied: copied === turn.id }"
                :aria-label="copied === turn.id ? 'Ответ скопирован' : 'Копировать ответ'"
                :title="copied === turn.id ? 'Скопировано' : 'Копировать ответ'"
                @click="copyMessage(turn.id, turn.text)"
              >
                <IconCheck v-if="copied === turn.id" aria-hidden="true" /><IconCopy
                  v-else
                  aria-hidden="true"
                />
              </button>
            </div>
            <div class="assistant-body">
              <div
                v-if="busy && index === turns.length - 1 && !turn.text"
                class="thinking"
                role="status"
              >
                <span class="thinking-dots" aria-hidden="true"><i /><i /><i /></span
                >{{
                  turn.tools.some((t) => t.status === "running") ? "Выполняет задачу" : "Думает"
                }}
              </div>
              <AgentActivity v-if="turn.tools.length" :tools="turn.tools" />
              <AgentMessage v-if="turn.text" :text="turn.text" />
            </div>
          </template>
        </article>
      </div>
    </div>
    <div class="composer-area">
      <button v-if="away" type="button" class="latest-button" @click="toBottom">
        <IconArrowDown aria-hidden="true" />К последнему сообщению
      </button>
      <p v-if="error || copyError" class="chat-error" role="alert">
        <IconAlert aria-hidden="true" />{{ error || copyError }}
      </p>
      <form class="composer" :class="{ working: busy }" @submit.prevent="submit">
        <textarea
          ref="input"
          v-model="draft"
          name="agent-message"
          aria-label="Сообщение агенту"
          placeholder="Что нужно сделать в проекте?"
          rows="1"
          @keydown="keydown"
        />
        <div class="composer-footer">
          <span class="composer-context"
            ><IconFolder aria-hidden="true" /><span>{{ projectName }}</span></span
          >
          <span class="input-hint"
            ><kbd>Enter</kbd> отправить<span> · <kbd>Shift ↵</kbd> новая строка</span></span
          >
          <button
            v-if="busy"
            type="button"
            class="send-button stop-button"
            title="Остановить"
            aria-label="Остановить"
            @click="stop"
          >
            <IconSquare aria-hidden="true" />
          </button>
          <button
            v-else
            type="submit"
            class="send-button"
            title="Отправить сообщение"
            aria-label="Отправить сообщение"
            :disabled="!draft.trim()"
          >
            <IconArrowUp aria-hidden="true" />
          </button>
        </div>
      </form>
      <span class="sr-only" role="status">{{ copied ? "Ответ скопирован" : "" }}</span>
    </div>
  </section>
</template>

<style scoped>
.agent-chat {
  --chat-width: 720px;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: #121210;
  container-type: inline-size;
  position: relative;
}
.chat-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid #262620;
  min-height: 53px;
}
.identity {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.header-mark {
  color: #b8baa6;
  display: flex;
}
.header-mark svg {
  width: 17px;
  height: 17px;
}
.agent-name {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.project-context {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--muted);
  font-size: 10px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.project-context svg {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
.header-actions {
  margin-left: auto;
  display: flex;
  gap: 12px;
  align-items: center;
  flex-shrink: 0;
}
.agent-status {
  font-size: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
}
.agent-status i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #96a684;
}
.agent-status.busy i {
  background: #c4b386;
  animation: pulse 1.4s ease-in-out infinite;
}
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 5px;
  color: var(--muted);
  transition:
    background 0.15s,
    color 0.15s;
}
.icon-button svg {
  width: 14px;
  height: 14px;
}
.icon-button:hover:not(:disabled) {
  background: #272720;
  color: var(--text);
}
.icon-button:disabled {
  opacity: 0.3;
  cursor: default;
}
button:focus-visible {
  outline: 1px solid var(--focus);
  outline-offset: 3px;
}
.chat-log {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: #3d3d33 transparent;
  padding: 32px 28px 28px;
}
.welcome {
  max-width: 490px;
  min-height: 100%;
  margin: auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 10px 0 26px;
  text-align: center;
}
.welcome-mark {
  width: 54px;
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #3a3b30;
  border-radius: 16px;
  background: #202119;
  color: #bbc0a6;
  box-shadow: inset 0 1px 0 #ffffff07;
  margin-bottom: 23px;
}
.welcome-mark svg {
  width: 27px;
  height: 27px;
  stroke-width: 1.3;
}
h1 {
  font-size: 26px;
  font-weight: 500;
  line-height: 1.3;
  letter-spacing: -0.04em;
  margin: 0 0 12px;
}
.welcome > p {
  color: #999b8e;
  font-size: 12px;
  line-height: 1.9;
  margin: 0;
}
.suggestions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 345px;
  margin-top: 30px;
}
.suggestions button {
  display: flex;
  align-items: center;
  gap: 13px;
  text-align: left;
  padding: 13px 15px;
  border: 1px solid #2e2f26;
  border-radius: 9px;
  background: #191a15;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.suggestions button:hover {
  border-color: #555744;
  background: #21221a;
}
.suggestion-icon {
  width: 17px;
  height: 17px;
  color: #a4ab90;
  flex-shrink: 0;
}
.suggestions strong {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: #d7d9ca;
}
.suggestions small {
  display: block;
  font-size: 10px;
  color: #858978;
  margin-top: 4px;
}
.suggestion-arrow {
  width: 13px;
  height: 13px;
  margin-left: auto;
  color: #626750;
  flex-shrink: 0;
}
.conversation {
  width: 100%;
  max-width: var(--chat-width);
  margin: auto;
}
.turn {
  min-width: 0;
  margin-bottom: 30px;
}
.turn:last-child {
  margin-bottom: 0;
}
.user {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  padding-left: 38px;
}
.user-label {
  font-size: 10px;
  color: var(--muted);
  margin: 0 3px 7px;
}
.user-message {
  max-width: 90%;
  margin: 0;
  padding: 13px 17px;
  border: 1px solid #33342b;
  border-radius: 12px 12px 3px 12px;
  background: #25261e;
  color: #dedfd3;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.assistant-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 28px;
  margin-bottom: 10px;
}
.avatar {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid #36382c;
  background: #24261d;
  color: #aeb99a;
  flex-shrink: 0;
}
.avatar svg {
  width: 16px;
  height: 16px;
  stroke-width: 1.6;
}
.sender {
  font-size: 11px;
  font-weight: 600;
  color: #d5d8c7;
}
.copy-button {
  margin-left: auto;
  opacity: 0.45;
}
.assistant:hover .copy-button,
.copy-button:focus-visible,
.copy-button.copied {
  opacity: 1;
}
.copy-button.copied {
  color: var(--run);
}
.assistant-body {
  padding-left: 38px;
  min-width: 0;
}
.thinking {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #9b9e8d;
  padding: 7px 0;
}
.thinking-dots {
  display: flex;
  gap: 3px;
}
.thinking-dots i {
  height: 4px;
  width: 4px;
  background: #a5ab91;
  border-radius: 50%;
  animation: pulse 1.2s ease-in-out infinite;
}
.thinking-dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.thinking-dots i:nth-child(3) {
  animation-delay: 0.3s;
}
.composer-area {
  width: 100%;
  max-width: calc(var(--chat-width) + 56px);
  margin: 0 auto;
  flex-shrink: 0;
  padding: 8px 28px 20px;
  position: relative;
}
.composer {
  border: 1px solid #424438;
  border-radius: 12px;
  background: #1c1d17;
  padding: 3px 4px 5px;
  box-shadow:
    0 8px 28px #00000016,
    inset 0 1px 0 #ffffff04;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.composer:focus-within {
  border-color: #7b8066;
  box-shadow:
    0 0 0 2px #9aa5810b,
    0 8px 28px #00000016;
}
.composer textarea {
  display: block;
  width: 100%;
  min-height: 53px;
  max-height: 180px;
  padding: 14px 13px 8px;
  background: none;
  border: 0;
  border-radius: 0;
  outline: none;
  resize: none;
  font: 13px/1.7 var(--sans);
  color: #e2e4d6;
  scrollbar-width: thin;
}
.composer textarea::placeholder {
  color: #858b75;
}
.composer-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 7px 1px 12px;
  min-height: 34px;
}
.composer-context {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 30%;
  font: 9px var(--mono);
  color: #a4ac92;
}
.composer-context svg {
  width: 11px;
  height: 11px;
  flex-shrink: 0;
}
.composer-context span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.input-hint {
  margin-left: auto;
  font-size: 9px;
  color: #797d6c;
  white-space: nowrap;
}
kbd {
  font-family: inherit;
  color: #a0a58e;
}
.send-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 31px;
  height: 31px;
  flex-shrink: 0;
  border-radius: 8px;
  color: #1e2217;
  background: #d5ddc2;
  transition:
    background 0.15s,
    transform 0.15s;
}
.send-button svg {
  width: 18px;
  height: 18px;
  stroke-width: 2;
}
.send-button:hover:not(:disabled) {
  background: #e7edda;
  transform: translateY(-1px);
}
.send-button:disabled {
  background: #33372b;
  color: #818b6c;
  cursor: default;
}
.stop-button {
  background: #c7cdb6;
}
.stop-button svg {
  width: 11px;
  height: 11px;
  fill: currentColor;
}
.latest-button {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 2px);
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  border-radius: 18px;
  border: 1px solid #444738;
  background: #25271e;
  color: #c7ceb6;
  font-size: 10px;
  white-space: nowrap;
  box-shadow: 0 4px 12px #0004;
}
.latest-button svg {
  width: 12px;
  height: 12px;
}
.chat-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border: 1px solid #583b31;
  border-radius: 8px;
  padding: 10px 12px;
  background: #2b211b;
  color: #dfb5a4;
  font-size: 11px;
  line-height: 1.6;
  margin: 0 0 10px;
  overflow-wrap: anywhere;
}
.chat-error svg {
  width: 14px;
  height: 14px;
  margin-top: 2px;
  flex-shrink: 0;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
@container (max-width: 500px) {
  .chat-header {
    gap: 10px;
    padding: 10px 14px;
  }
  .project-context {
    display: none;
  }
  .chat-log {
    padding: 24px 16px;
  }
  .composer-area {
    padding: 8px 16px 16px;
  }
  .input-hint > span {
    display: none;
  }
  .assistant-body {
    padding-left: 0;
  }
  .user {
    padding-left: 15px;
  }
  .user-message {
    max-width: 96%;
  }
  h1 {
    font-size: 22px;
  }
}
@container (max-width: 300px) {
  .agent-status {
    display: none;
  }
  .input-hint {
    display: none;
  }
  .send-button {
    margin-left: auto;
  }
  .composer-context {
    max-width: 70%;
  }
  .suggestions button {
    padding: 11px;
  }
  .suggestions small {
    display: none;
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
