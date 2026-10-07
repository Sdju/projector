<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useIdeCommands } from "../../ide/index.ts";
import { useProjects } from "../../project/index.ts";
import { agentCommandHandler } from "../model/commands.ts";
import { useAgent } from "../model/session.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import AgentWelcome from "./AgentWelcome.vue";
import AgentTurn from "./AgentTurn.vue";
import AgentComposer from "./AgentComposer.vue";
import AgentPermissions from "./AgentPermissions.vue";
import AgentPermissionMode from "./AgentPermissionMode.vue";
import type { AgentBackendId } from "../model/types.ts";
import IconClaude from "~icons/simple-icons/claude";
import IconBot from "~icons/lucide/bot";
import IconSquarePen from "~icons/lucide/square-pen";
import IconFolder from "~icons/lucide/folder";

const props = withDefaults(
  defineProps<{ projectId: string; backend?: AgentBackendId; chatId?: string }>(),
  { backend: "projector", chatId: undefined },
);
/** Claude Code is the plain coding agent: no Projector tools, its own approvals. */
const plain = computed(() => props.backend === "claude-code");
const agentName = computed(() => (plain.value ? "Claude Code" : "Projector"));
const { api } = useIdeCommands();
const { projects } = useProjects();
const projectName = computed(
  () => projects.value.find((p) => p.id === props.projectId)?.name ?? "Текущий проект",
);
const { turns, draft, busy, error, phase, permissions, permissionMode, send, clear, stop, decide } =
  useAgent(props.projectId, plain.value ? undefined : agentCommandHandler(api, props.projectId), {
    backend: props.backend,
    chatId: props.chatId,
  });
const log = ref<HTMLElement>();
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
  stop();
  observer?.disconnect();
  cancelAnimationFrame(frame);
  clearTimeout(copyTimer);
});
</script>

<template>
  <section class="agent-chat" aria-label="Чат с агентом">
    <header class="chat-header">
      <div class="identity">
        <span class="header-mark"
          ><IconClaude v-if="plain" aria-hidden="true" /><IconBot v-else aria-hidden="true" /></span
        ><span class="agent-name">{{ agentName }}</span>
      </div>
      <span class="project-context" :title="projectName"
        ><IconFolder aria-hidden="true" />{{ projectName }}</span
      >
      <div class="header-actions">
        <span class="agent-status" :class="{ busy }" role="status" :title="phase"
          ><i aria-hidden="true" />{{ busy ? "Работает" : "Готов" }}</span
        >
        <UiButton
          icon
          size="sm"
          title="Новый чат"
          aria-label="Новый чат"
          :disabled="busy || !turns.length"
          @click="newChat"
        >
          <IconSquarePen aria-hidden="true" />
        </UiButton>
      </div>
    </header>
    <div ref="log" class="chat-log" @scroll.passive="trackScroll">
      <AgentWelcome v-if="!turns.length" :plain="plain" @suggest="suggest" />
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
          :sender="agentName"
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
      :project-name="projectName"
      @submit="submit"
      @stop="stop"
      @latest="toBottom"
    >
      <template v-if="plain" #footer>
        <AgentPermissionMode v-model="permissionMode" :disabled="busy" />
      </template>
    </AgentComposer>
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
  background: var(--bg-sunken);
  container-type: inline-size;
  position: relative;
}
.chat-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--line);
  min-height: 53px;
}
.identity {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.header-mark {
  color: var(--text-2);
  display: flex;
}
.header-mark svg {
  width: 17px;
  height: 17px;
}
.agent-name {
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.project-context {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--muted);
  font-size: var(--fs-2xs);
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
  font-size: var(--fs-2xs);
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
}
.agent-status i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--run);
}
.agent-status.busy i {
  background: var(--warn);
  animation: pulse 1.4s ease-in-out infinite;
}
.chat-log {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overflow-anchor: none;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
  padding: 32px 28px 28px;
}
.permission-dock {
  width: 100%;
  max-width: calc(var(--chat-width) + 56px);
  margin: 0 auto;
  padding: 0 28px;
  flex-shrink: 0;
}
.conversation {
  width: 100%;
  max-width: var(--chat-width);
  margin: auto;
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
}
@container (max-width: 300px) {
  .agent-status {
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
