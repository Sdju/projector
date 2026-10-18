<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useIdeCommands } from "../../ide/index.ts";
import { workspaceRequest } from "../../workspace-api/index.ts";
import { agentCommandHandler } from "../model/commands.ts";
import { agentLabel, guiPrograms } from "../model/modes.ts";
import { useAgent } from "../model/session.ts";
import { readoutLines, useTabReadout } from "../../../common/utilities/tab-readout.ts";
import UiPanel from "../../../common/ui/UiPanel.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import AgentWelcome from "./AgentWelcome.vue";
import AgentTurn from "./AgentTurn.vue";
import AgentComposer from "./AgentComposer.vue";
import AgentQuestions from "./AgentQuestions.vue";
import AgentSecrets from "./AgentSecrets.vue";
import AgentPermissions from "./AgentPermissions.vue";
import AgentContextMeter from "./AgentContextMeter.vue";
import AgentChipPreview from "./AgentChipPreview.vue";
import AgentControls from "./AgentControls.vue";
import AgentSessions from "./AgentSessions.vue";
import AgentPlan from "./AgentPlan.vue";
import AgentQueue from "./AgentQueue.vue";
import AgentTaskBar from "./AgentTaskBar.vue";
import AgentTaskView from "./AgentTaskView.vue";
import { barTasks, chatTasks, taskDetail } from "../lib/task-detail.ts";
import AgentRewind from "./AgentRewind.vue";
import AgentWorktree from "./AgentWorktree.vue";
import { chatMarkdown } from "../lib/export.ts";
import { latestPlan } from "../lib/plan.ts";
import { fetchMcpServers, type McpServer } from "../api/client.ts";
import { activateChat, registerChat, type ChatController } from "../model/chat-registry.ts";
import { useRewindPanel } from "../model/rewind-panel.ts";
import { useWorktreePanel } from "../model/worktree-panel.ts";
import type { AgentBackendId, MessageChip, RewindScope } from "../model/types.ts";
import IconSquarePen from "~icons/lucide/square-pen";
import IconDownload from "~icons/lucide/download";
import IconBranch from "~icons/lucide/git-branch";

const props = withDefaults(
  defineProps<{ projectId: string; backend?: AgentBackendId; chatId?: string }>(),
  { backend: "projector", chatId: undefined },
);
/** External agents are plain coding agents: no Projector tools, their own approvals. */
const plain = computed(() => props.backend !== "projector");
const agentName = computed(() => agentLabel(props.backend));
const { api } = useIdeCommands();
const {
  turns,
  draft,
  draftParts,
  busy,
  error,
  phase,
  permissions,
  questions,
  secrets,
  controls,
  capabilities,
  sessions,
  sessionsLoading,
  sessionsError,
  loadControls,
  loadCommands,
  commands: slashCommands,
  setControl,
  loadSessions,
  changeSession,
  resumeSession,
  removeSession,
  send,
  queue,
  sendQueuedNow,
  injectQueued,
  removeQueued,
  edit,
  cancelEdit,
  editing,
  retry,
  showVersion,
  canRewindFiles,
  rewindFiles,
  isolate,
  worktreeId,
  worktreeInfo,
  mergeCopy,
  discardCopy,
  clear,
  stop,
  attach,
  release,
  decide,
  answer,
  answerSecret,
} = useAgent(props.projectId, plain.value ? undefined : agentCommandHandler(api, props.projectId), {
  backend: props.backend,
  chatId: props.chatId,
});
onMounted(() => {
  void loadControls();
  void loadCommands();
});
const latestContext = computed(() => turns.value.findLast((turn) => turn.context)?.context);
const activeSession = computed(
  () => turns.value.findLast((turn) => turn.role === "assistant")?.session?.id,
);
// Opening a chat is a workspace command, not one of this chat's own.
function openCoder(program: string) {
  void api
    .executeCommand(guiPrograms[program]!.command, undefined, {
      scope: `editor:${props.projectId}`,
    })
    .catch((cause) => {
      error.value = cause instanceof Error ? cause.message : "Не удалось открыть агента";
    });
}
attach();
// Subagents and background commands sit above the input; one can be read here or in a tab.
const tasks = computed(() => barTasks(turns.value));
const viewingTask = ref("");
const viewed = computed(() =>
  viewingTask.value ? taskDetail(turns.value, viewingTask.value) : undefined,
);
// The task left the chat (rewind, a new session): there is nothing to show any more.
watch(
  () => !!viewingTask.value && !viewed.value,
  (gone) => {
    if (gone) viewingTask.value = "";
  },
);
function viewTask(id: string) {
  viewingTask.value = viewingTask.value === id ? "" : id;
}
function taskInTab(id: string) {
  const task = chatTasks(turns.value).find((item) => item.id === id);
  void api
    .executeCommand(
      "ide.workbench.agent.task.open",
      { chat: chatKey, task: id, title: task?.title },
      { scope: `editor:${props.projectId}` },
    )
    .catch((cause) => {
      error.value = cause instanceof Error ? cause.message : "Не удалось открыть задачу";
    });
}
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
const panel = ref<InstanceType<typeof UiPanel>>();
const root = computed(() => panel.value?.element);

// The project folder: edited files and dropped paths are shown relative to it.
const projectRoot = ref("");
void workspaceRequest<{ root: string }>(props.projectId, "root")
  .then((data) => {
    projectRoot.value = data.root;
  })
  .catch(() => {});

// MCP servers shown in the parameters island; read when it opens, as that starts a probe process.
const mcp = ref<McpServer[]>([]);
async function loadMcp() {
  if (!plain.value) return;
  try {
    mcp.value = await fetchMcpServers(props.backend, props.projectId);
  } catch {
    mcp.value = [];
  }
}

const { copy, copyInfo, copyWorking, copyNote, endCopy } = useWorktreePanel(turns, busy, {
  worktreeInfo,
  mergeCopy,
  discardCopy,
});

// While a message is being edited, the turns its replacement will cut off are shown faded.
const editFrom = computed(() =>
  editing.value ? turns.value.findIndex((turn) => turn.id === editing.value) : -1,
);

// The plan stays pinned while it has unfinished items, even after later messages; a finished one
// only shows for the answer that finished it.
const plan = computed(() => {
  const answers = turns.value.filter((turn) => turn.role === "assistant");
  for (const turn of answers.toReversed()) {
    const items = latestPlan(turn);
    if (!items.length) continue;
    return turn === answers.at(-1) || items.some((item) => item.status !== "completed")
      ? items
      : [];
  }
  return [];
});
const contextShare = computed(() =>
  latestContext.value ? latestContext.value.used / Math.max(1, latestContext.value.size) : 0,
);

// Rolling back to a message: the panel asks what to undo, shows what the files would change, then does it.
const {
  rewinding,
  rewindPreview,
  rewindPreviewError,
  rewindResult,
  rewindWorking,
  askRewind,
  previewRewind,
  rewindTo,
  confirmRewind,
  closeRewind,
} = useRewindPanel({ rewindFiles, edit, focus: () => composer.value?.focus() });
// A request's own answers belong to the user message before them.
function precedingUser(id: string): string {
  const index = turns.value.findIndex((turn) => turn.id === id);
  return turns.value.slice(0, index + 1).findLast((turn) => turn.role === "user")?.id ?? "";
}
function canRevert(id: string): boolean {
  return canRewindFiles(precedingUser(id));
}
async function editMessage(id: string) {
  edit(id);
  await nextTick();
  composer.value?.focus();
}
async function retryMessage(id: string) {
  void toBottom();
  await retry(id);
}

// A full context is compacted once the answer is over, unless the last message already was that.
watch(busy, (working) => {
  if (
    working ||
    !capabilities.value.compact ||
    contextShare.value < capabilities.value.compact.autoAt ||
    queue.value.length
  )
    return;
  if (
    turns.value.findLast((turn) => turn.role === "user")?.text ===
    capabilities.value.compact.command
  )
    return;
  if (error.value) return;
  void compact();
});

async function compact() {
  void toBottom();
  const policy = capabilities.value.compact;
  if (!policy) throw new Error("Агент не поддерживает сжатие разговора");
  await send(policy.command);
}
function exportMarkdown() {
  return chatMarkdown(turns.value, `${agentName.value} · ${new Date().toLocaleString("ru")}`);
}
function downloadChat() {
  const url = URL.createObjectURL(
    new Blob([exportMarkdown()], { type: "text/markdown;charset=utf-8" }),
  );
  const link = Object.assign(document.createElement("a"), {
    href: url,
    download: `${props.backend}-chat.md`,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The chat publishes itself to the workspace's commands (see `registerAgentCommands`).
const chatKey = `${props.backend}:${props.chatId ?? props.projectId}`;
const controller: ChatController = {
  key: chatKey,
  projectId: props.projectId,
  backend: props.backend,
  label: agentName.value,
  busy: () => busy.value,
  visible: () => !!root.value && root.value.getClientRects().length > 0,
  turns: () => turns.value,
  tasks: () => chatTasks(turns.value),
  queue: () => queue.value,
  controls: () => controls.value,
  capabilities: () => capabilities.value,
  setControl,
  loadSessions,
  resumeSession,
  removeSession,
  toggleControlsMenu: () => controlsMenu.value?.toggle(),
  send: (text) => send(text),
  inject: async (text) => {
    await send(text);
    const item = queue.value.findLast((entry) => entry.text === text.trim());
    if (!item) return false;
    return injectQueued(item.id);
  },
  stop,
  edit,
  retry,
  rewind: async (id, scope) => {
    const result = await rewindTo(id, scope);
    return result ?? { ok: true, files: [] };
  },
  showVersion,
  removeQueued,
  exportMarkdown,
  compact,
  mcpServers: () => fetchMcpServers(props.backend, props.projectId),
  worktree: async () => (worktreeId() ? worktreeInfo() : undefined),
  mergeWorktree: mergeCopy,
  discardWorktree: discardCopy,
  setIsolate: (on) => {
    isolate.value = on;
  },
};
const unregisterChat = registerChat(controller);
onBeforeUnmount(unregisterChat);
// A file chip opens its file in the editor; an image chip opens the picture itself.
function openChip(chip: MessageChip) {
  if (chip.type === "image")
    window.open(`/api/agent/attachments/${encodeURIComponent(chip.id)}`, "_blank", "noopener");
  else if (chip.type === "file")
    void api
      .executeCommand(
        "ide.editor.path.open",
        { path: chip.path, directory: chip.directory === true },
        { scope: `editor:${props.projectId}` },
      )
      .catch((cause) => {
        error.value = cause instanceof Error ? cause.message : "Не удалось открыть файл";
      });
}
const away = ref(false);
const copied = ref("");
const copyError = ref("");
function dismissError() {
  error.value = "";
  copyError.value = "";
}
let copyTimer: ReturnType<typeof setTimeout> | undefined;
let observer: ResizeObserver | undefined;
// Content growth never changes scrollTop, so only a decrease is a user scrolling up.
// Shrinking content (a collapsing thought block) clamps scrollTop by itself: that is not the user.
let lastTop = 0;
let lastHeight = 0;
function trackScroll() {
  const element = log.value;
  if (!element || !element.clientHeight) return;
  const top = element.scrollTop;
  const shrunk = element.scrollHeight < lastHeight;
  lastHeight = element.scrollHeight;
  if (element.scrollHeight - top - element.clientHeight <= 72) away.value = false;
  else if (top < lastTop && !shrunk) away.value = true;
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
    lastHeight = element.scrollHeight;
  });
}
async function toBottom() {
  away.value = false;
  await nextTick();
  pin();
}
async function submit() {
  if (!draft.value.trim()) return;
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
    questions.value.length,
    secrets.value.length,
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
  <UiPanel
    ref="panel"
    class="agent-chat"
    aria-label="Чат с агентом"
    @focusin="activateChat(controller)"
    @pointerdown.capture="activateChat(controller)"
  >
    <UiInline class="chat-tools" :gap="1" align="normal" justify="normal">
      <AgentSessions
        :sessions="sessions"
        :loading="sessionsLoading"
        :error="sessionsError"
        :disabled="busy"
        :active="activeSession"
        :editable="!plain || capabilities.editSessions"
        :deletable="!plain || capabilities.deleteSessions"
        :label="plain ? undefined : 'История чатов'"
        @open="loadSessions"
        @change="changeSession"
        @remove="(id) => void removeSession(id).catch(() => {})"
        @pick="(id) => void resumeSession(id).catch(() => {})"
      />
      <UiButton
        v-if="plain && !turns.length"
        shape="icon"
        size="sm"
        :class="{ on: isolate }"
        :aria-pressed="isolate"
        title="Работать в изолированной копии проекта (git worktree): изменения агента не затронут файлы, пока вы их не влёте"
        aria-label="Работать в изолированной копии проекта"
        @click="isolate = !isolate"
      >
        <IconBranch aria-hidden="true" />
      </UiButton>
      <UiButton
        v-if="turns.length"
        shape="icon"
        size="sm"
        title="Сохранить чат в Markdown"
        aria-label="Сохранить чат в Markdown"
        @click="downloadChat"
      >
        <IconDownload aria-hidden="true" />
      </UiButton>
      <UiButton
        v-if="turns.length"
        shape="icon"
        size="sm"
        title="Новый чат"
        aria-label="Новый чат"
        :disabled="busy"
        @click="newChat"
      >
        <IconSquarePen aria-hidden="true" />
      </UiButton>
    </UiInline>
    <div v-show="!viewed" ref="log" class="chat-log" @scroll.passive="trackScroll">
      <AgentWelcome
        v-if="!turns.length"
        :plain="plain"
        :agent-name="agentName"
        @suggest="suggest"
        @open="openCoder"
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
          :faded="editFrom >= 0 && index >= editFrom"
          :root="projectRoot"
          :can-revert="canRevert(turn.id)"
          @copy="copyMessage"
          @open="openChip"
          @edit="editMessage"
          @rewind="askRewind"
          @retry="retryMessage"
          @version="showVersion"
          @open-file="(path) => openChip({ type: 'file', path })"
          @revert="(id) => askRewind(precedingUser(id), 'files')"
        />
      </div>
    </div>
    <AgentTaskView
      v-if="viewed"
      :detail="viewed"
      :project-id="projectId"
      :backend="backend"
      embedded
      @back="viewingTask = ''"
      @tab="taskInTab(viewed.task.id)"
    />
    <div class="dock">
      <p v-if="editing" class="edit-hint" role="status">
        Правка сообщения: новое заменит выделенное и всё после него, старый вариант останется
        версией.
        <button type="button" @click="cancelEdit">Отмена</button>
      </p>
      <AgentPermissions :permissions="permissions" @decide="decide" />
      <AgentQuestions :requests="questions" @answer="answer" />
      <AgentSecrets :requests="secrets" @answer="answerSecret" />
      <AgentRewind
        v-if="rewinding"
        :key="rewinding.id"
        :can-files="canRewindFiles(rewinding.id)"
        :preview="rewindPreview"
        :preview-error="rewindPreviewError"
        :working="rewindWorking"
        :result="rewindResult"
        :root="projectRoot"
        :initial="rewinding.scope"
        @scope="previewRewind"
        @confirm="confirmRewind"
        @cancel="closeRewind"
      />
      <AgentWorktree
        v-if="copy"
        :branch="copy.branch"
        :info="copyInfo"
        :working="copyWorking || busy"
        :note="copyNote"
        @merge="endCopy(mergeCopy)"
        @discard="endCopy(discardCopy)"
      />
      <AgentPlan :items="plan" :busy="busy" />
      <p
        v-if="capabilities.compact && contextShare >= capabilities.compact.hintAt && !busy"
        class="compact-hint"
        :class="{ urgent: contextShare >= capabilities.compact.autoAt }"
        role="status"
      >
        <template v-if="contextShare >= capabilities.compact.autoAt"
          >Контекст почти заполнен ({{ Math.round(contextShare * 100) }}%): после этого ответа он
          сожмётся сам.</template
        >
        <template v-else>Контекст заполнен на {{ Math.round(contextShare * 100) }}%.</template>
        <button type="button" @click="compact">Сжать сейчас</button>
      </p>
      <AgentTaskBar :tasks="tasks" :viewing="viewingTask" @view="viewTask" @tab="taskInTab" />
      <AgentQueue
        :items="queue"
        :busy="busy"
        :can-inject="!!capabilities.inject"
        @now="sendQueuedNow"
        @inject="injectQueued"
        @remove="removeQueued"
      />
    </div>
    <AgentComposer
      v-show="!viewed"
      ref="composer"
      v-model="draft"
      v-model:parts="draftParts"
      :project-id="projectId"
      :commands="slashCommands"
      :busy="busy"
      :away="away"
      :error="error || copyError"
      :copied="!!copied"
      @submit="submit"
      @open="openChip"
      @fail="(message) => (error = message)"
      @dismiss="dismissError"
      @stop="stop"
      @latest="toBottom"
    >
      <template v-if="latestContext" #status>
        <AgentContextMeter :context="latestContext" />
      </template>
      <template v-if="controls.length" #controls>
        <AgentControls
          ref="controlsMenu"
          :controls="controls"
          :disabled="busy"
          :mcp="mcp"
          @opened="loadMcp"
          @change="setControl"
        />
      </template>
    </AgentComposer>
    <AgentChipPreview :project-id="projectId" :scope="root" />
  </UiPanel>
</template>
<style scoped>
.agent-chat {
  --chat-width: 680px;
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
}
.chat-tools .on {
  color: var(--text);
  background: var(--bg-4);
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
.dock {
  position: relative;
  width: 100%;
  max-width: calc(var(--chat-width) + 56px);
  margin: 0 auto;
  padding: 0 var(--sp-5);
  flex-shrink: 0;
}
.compact-hint {
  margin: 0 0 var(--sp-2);
  color: var(--warn);
  font-size: var(--fs-2xs);
}
.compact-hint.urgent {
  color: var(--err);
}
.edit-hint {
  margin: 0 0 var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.edit-hint button,
.compact-hint button {
  color: var(--text-2);
  text-decoration: underline;
  text-underline-offset: 3px;
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
