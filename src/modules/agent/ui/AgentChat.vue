<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import { widgetReplyKey } from "../../widget-runtime/index.ts";
import { chatProjectKey } from "../../chat-images/index.ts";
import { useIdeCommands } from "../../ide/index.ts";
import { workspaceRequest } from "../../workspace-api/index.ts";
import { AgentFeaturesIsland } from "../../agent-features/index.ts";
import AgentJudgeIsland from "./AgentJudgeIsland.vue";
import { agentCommandHandler } from "../model/commands.ts";
import { agentLabel, guiCommand, isBuiltinAgent } from "../model/modes.ts";
import { chatDropHandlers } from "../lib/chat-drop.ts";
import { useChatBranch } from "../model/chat-branch.ts";
import { useChatReadout } from "../model/chat-readout.ts";
import { useAgent } from "../model/session.ts";
import { useChatJobs } from "../model/chat-jobs.ts";
import { lensActions, useAgentLens } from "../model/lens.ts";
import { useSideQuestion } from "../model/side-question.ts";
import { useAutoCompact } from "../model/use-auto-compact.ts";
import { useChatInputActions } from "../model/use-chat-input-actions.ts";
import { useAnswerForm } from "../model/answer-form.ts";
import UiPanel from "../../../common/ui/UiPanel.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import AgentWelcome from "./AgentWelcome.vue";
import AgentTurn from "./AgentTurn.vue";
import AgentComposer from "./AgentComposer.vue";
import AgentActivityDock from "./AgentActivityDock.vue";
import AgentJobRequests from "./AgentJobRequests.vue";
import AgentQuestions from "./AgentQuestions.vue";
import AgentSecrets from "./AgentSecrets.vue";
import AgentPermissions from "./AgentPermissions.vue";
import AgentContextMeter from "./AgentContextMeter.vue";
import AgentChipPreview from "./AgentChipPreview.vue";
import AgentControls from "./AgentControls.vue";
import AgentSessions from "./AgentSessions.vue";
import AgentSideQuestion from "./AgentSideQuestion.vue";
import AgentTaskView from "./AgentTaskView.vue";
import AgentChatMenu from "./AgentChatMenu.vue";
import { chatTasks } from "../lib/task-detail.ts";
import { useChatTaskView } from "../model/use-chat-task-view.ts";
import AgentRewind from "./AgentRewind.vue";
import AgentWorktree from "./AgentWorktree.vue";
import { openChatChip } from "./open-chip.ts";
import { exportChat, downloadChat as saveChatMarkdown } from "../lib/export.ts";
import { copyText } from "../lib/clipboard.ts";
import { shownPlan } from "../lib/plan.ts";
import { previousUser } from "../lib/previous-user.ts";
import { fetchMcpServers } from "../api/client.ts";
import { useMcpServers } from "../model/mcp-panel.ts";
import { activateChat, registerChat, type ChatController } from "../model/chat-registry.ts";
import { useChatWindow } from "../model/chat-window.ts";
import { useRewindPanel } from "../model/rewind-panel.ts";
import { useWorktreePanel } from "../model/worktree-panel.ts";
import { chatUsageByTurn } from "../model/chat-usage.ts";
import type { AgentBackendId, ChatUsage, MessageChip, RewindScope } from "../model/types.ts";
import IconArrowDown from "~icons/lucide/arrow-down";
import IconSquarePen from "~icons/lucide/square-pen";
const props = withDefaults(
  defineProps<{ projectId: string; backend?: AgentBackendId; chatId?: string }>(),
  { backend: "projector", chatId: undefined },
);
/** External agents are plain coding agents: no Projector tools, their own approvals. */
const plain = computed(() => !isBuiltinAgent(props.backend));
const agentName = computed(() => agentLabel(props.backend));
const { api } = useIdeCommands();
const chatMenu = ref<InstanceType<typeof AgentChatMenu>>();
const featuresIsland = ref<InstanceType<typeof AgentFeaturesIsland>>();
const judgeIsland = ref<InstanceType<typeof AgentJudgeIsland>>();
const {
  key: chatKey,
  turns,
  loading,
  draft,
  draftParts,
  busy,
  error,
  phase,
  lastEventAt,
  permissions,
  questions,
  secrets,
  controls,
  selection,
  capabilities,
  sessions,
  sessionsLoading,
  sessionsError,
  recent,
  recentLoading,
  recentError,
  loadControls,
  loadCommands,
  commands: agentCommands,
  setControl,
  loadSessions,
  loadRecent,
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
  featureOverrides,
  setFeatureOverrides,
  judgeOverride,
  setJudgeOverride,
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
const jobsState = useChatJobs({
  projectId: props.projectId,
  chat: chatKey,
  enabled: () => !plain.value,
  send: (text, options) => send(text, undefined, options),
  permissions,
  questions,
  secrets,
});
onMounted(() => {
  void loadControls();
  void loadCommands();
});
let shownUsage: Map<string, ChatUsage> | undefined;
const chatUsage = computed(() => (shownUsage = chatUsageByTurn(turns.value, shownUsage)));
const latestContext = computed(() => turns.value.findLast((turn) => turn.context)?.context);
const activeSession = computed(
  () => turns.value.findLast((turn) => turn.role === "assistant")?.session?.id,
);
const side = useSideQuestion({
  chat: chatKey,
  projectId: props.projectId,
  backend: props.backend,
  turns,
  busy,
  phase,
  lastEventAt,
  permissions,
  questions,
  secrets,
  queue,
  selection,
  commands: agentCommandHandler(api, props.projectId),
});
const slashCommands = computed(() => [
  { name: "btw", description: "Вопрос в сторону, не прерывая агента" },
  ...agentCommands.value,
]);
// Branching and the project's chat list sit beside the chat: see `useChatBranch`.
const {
  fork,
  forkMessage,
  recentChats,
  openRecent: openRecentChat,
} = useChatBranch({
  backend: props.backend,
  projectId: props.projectId,
  key: chatKey,
  turns: () => turns.value,
  capabilities: () => capabilities.value,
  recent: () => recent.value,
  api,
  fail: (message) => {
    error.value = message;
  },
});
// Opening a chat is a workspace command, not one of this chat's own.
function openAgent(program: string) {
  void api
    .executeCommand(guiCommand(program), undefined, {
      scope: `editor:${props.projectId}`,
    })
    .catch((cause) => {
      error.value = cause instanceof Error ? cause.message : "Не удалось открыть агента";
    });
}
attach();
// Subagents and background commands sit above the input; one can be read here or in a tab.
const {
  tasks,
  viewing: viewingTask,
  viewed,
  view: viewTask,
  open: taskInTab,
} = useChatTaskView({
  turns,
  openTab: (task, id) => {
    void api
      .executeCommand(
        "ide.workbench.agent.task.open",
        { chat: chatKey, task: task?.id ?? id, title: task?.title },
        { scope: `editor:${props.projectId}` },
      )
      .catch((cause) => {
        error.value = cause instanceof Error ? cause.message : "Не удалось открыть задачу";
      });
  },
});
// Что штатный агент видит в чате: статус, последний ответ и чипы инструментов.
useChatReadout({
  backend: props.backend,
  agent: agentName.value,
  busy,
  phase,
  error,
  controls,
  turns,
});
const log = ref<HTMLElement>();
const controlsMenu = ref<InstanceType<typeof AgentControls>>();
const composer = ref<InstanceType<typeof AgentComposer>>();
const chatDrop = chatDropHandlers(() => composer.value);
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
const { mcp, load: loadMcpServers } = useMcpServers(() => props.backend, props.projectId);
const loadMcp = () => (plain.value ? loadMcpServers() : Promise.resolve());
const { copy, copyInfo, copyWorking, copyNote, endCopy } = useWorktreePanel(turns, busy, {
  worktreeInfo,
  mergeCopy,
  discardCopy,
});
// While a message is being edited, the turns its replacement will cut off are shown faded.
const editFrom = computed(() =>
  editing.value ? turns.value.findIndex((turn) => turn.id === editing.value) : -1,
);
const { pendingForm, originalForm, submitComposerForm, submitTurnForm } = useAnswerForm({
  turns,
  busy,
  draft,
  draftParts,
  selection,
  send,
  edit,
});
// The plan stays pinned while it has unfinished items, even after later messages.
const plan = computed(() => shownPlan(turns.value, props.backend));
const contextShare = computed(() =>
  latestContext.value ? latestContext.value.used / Math.max(1, latestContext.value.size) : 0,
);
const lens = useAgentLens({ turns, busy, phase, queue, plan, selection });
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
const precedingUser = (id: string) => previousUser(turns.value, id);
const canRevert = (id: string) => canRewindFiles(precedingUser(id));
async function editMessage(id: string) {
  edit(id);
  await nextTick();
  composer.value?.focus();
}
async function retryMessage(id: string) {
  void toBottom();
  await retry(id);
}
/** The list of the chat's own history and the project's chats is read when the panel opens. */
async function openHistory() {
  await Promise.all([loadSessions(), loadRecent()]);
}
const { compact } = useAutoCompact({
  busy,
  capabilities,
  contextShare,
  queue,
  turns,
  error,
  send,
  toBottom,
});
// The chat publishes itself to the workspace's commands (see `registerAgentCommands`).
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
  selection: () => selection.value,
  capabilities: () => capabilities.value,
  setControl,
  loadSessions,
  resumeSession,
  removeSession,
  toggleControlsMenu: () => controlsMenu.value?.toggle(),
  send: (text) => send(text),
  pendingForm: () => pendingForm.value,
  showForm: () => composer.value?.showForm(),
  hideForm: () => composer.value?.hideForm(),
  inject: async (text) => {
    await send(text);
    const item = queue.value.findLast((entry) => entry.text === text.trim());
    if (!item) return false;
    return injectQueued(item.id);
  },
  stop,
  edit,
  retry,
  fork,
  rewind: async (id, scope) => {
    const result = await rewindTo(id, scope);
    return result ?? { ok: true, files: [] };
  },
  showVersion,
  removeQueued,
  exportMarkdown: () => exportChat(turns.value, agentName.value),
  compact,
  status: () => side.status(),
  openSide: () => side.openPanel(),
  askSide: (text) => side.ask(text),
  clearSide: () => side.clear(),
  ...lensActions(lens),
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
const openChip = (chip: MessageChip) =>
  openChatChip(chip, {
    openFile: (path, directory) =>
      api.executeCommand(
        "ide.editor.path.open",
        { path, directory },
        { scope: `editor:${props.projectId}` },
      ),
    fail: (message) => (error.value = message),
  });
const away = ref(false);
const { PRELOAD_PX, firstShown, shown, hidden, loadEarlier, topUp } = useChatWindow(
  turns,
  log,
  () => {
    lastTop = log.value!.scrollTop;
    lastHeight = log.value!.scrollHeight;
  },
  loading,
);
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
  if (top < PRELOAD_PX) void topUp();
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
// Components in the answers write back into this chat; a busy agent queues the message.
provide(widgetReplyKey, (text) => {
  void toBottom();
  void send(text);
});
provide(chatProjectKey, props.projectId);
const { submit, continueTurn, suggest, newChat } = useChatInputActions({
  draft,
  draftParts,
  send,
  side,
  clear,
  toBottom,
  resetAway: () => {
    away.value = false;
  },
  resize: () => composer.value?.resize(),
  focus: () => composer.value?.focus(),
});
async function copyMessage(id: string, text: string) {
  if (!(await copyText(text))) {
    copyError.value = "Не удалось скопировать ответ";
    return;
  }
  copied.value = id;
  copyError.value = "";
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copied.value = "";
  }, 2000);
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
    // A short window leaves no room to scroll: fill it from above.
    void topUp(true);
  },
);
// A chat tab stays mounted while hidden: the input takes focus each time the tab is shown.
let tabShown = false;
onMounted(() => {
  composer.value?.resize();
  observer = new ResizeObserver(() => {
    pin();
    composer.value?.resize();
    const nowShown = !!root.value && root.value.getClientRects().length > 0;
    if (nowShown && !tabShown) composer.value?.focus();
    tabShown = nowShown;
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
    @dragenter="chatDrop.dragenter"
    @dragover="chatDrop.dragover"
    @dragleave="chatDrop.dragleave"
    @drop="chatDrop.drop"
  >
    <div v-if="chatDrop.over.value" class="chat-drop-hint" aria-hidden="true">
      Бросьте файлы или папки — добавим в сообщение
    </div>
    <UiInline class="chat-tools" :gap="1" align="normal" justify="end">
      <AgentSessions
        :sessions="sessions"
        :loading="sessionsLoading"
        :error="sessionsError"
        :disabled="busy"
        :active="activeSession"
        :editable="!plain || capabilities.editSessions"
        :deletable="!plain || capabilities.deleteSessions"
        :recent="recentChats"
        :recent-loading="recentLoading"
        :recent-error="recentError"
        @open="openHistory"
        @change="changeSession"
        @remove="(target) => void removeSession(target).catch(() => {})"
        @pick="(id) => void resumeSession(id).catch(() => {})"
        @open-recent="openRecentChat"
      />
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
      <AgentChatMenu
        ref="chatMenu"
        :lens="lens.state.open"
        :side="side.state.open"
        :can-download="turns.length > 0"
        :can-isolate="plain && !turns.length"
        :isolate="isolate"
        :features-changed="featureOverrides !== undefined"
        :judge-changed="judgeOverride !== undefined"
        @features="featuresIsland?.openAt(chatMenu?.anchor())"
        @judge="judgeIsland?.openAt(chatMenu?.anchor())"
        @lens="lens.toggle()"
        @side="side.toggle()"
        @download="saveChatMarkdown(turns, agentName, backend)"
        @isolate="isolate = !isolate"
      />
    </UiInline>
    <AgentFeaturesIsland
      ref="featuresIsland"
      :show-trigger="false"
      :anchor="() => chatMenu?.anchor()"
      :backend="backend"
      :chat="chatKey"
      :overrides="featureOverrides"
      :disabled="loading"
      @update:overrides="setFeatureOverrides"
    />
    <AgentJudgeIsland
      ref="judgeIsland"
      :show-trigger="false"
      :anchor="() => chatMenu?.anchor()"
      :chat="chatKey"
      :override="judgeOverride"
      :disabled="loading"
      @update:override="setJudgeOverride"
    />
    <div v-show="!viewed" ref="log" class="chat-log" @scroll.passive="trackScroll">
      <div v-if="loading" class="chat-loading" role="status">
        <UiSpinner />
        <span>Загружаю чат…</span>
      </div>
      <AgentWelcome
        v-else-if="!turns.length"
        :plain="plain"
        :agent-name="agentName"
        @suggest="suggest"
        @open="openAgent"
      />
      <div
        v-else
        class="conversation"
        role="log"
        aria-label="Сообщения"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <button v-if="hidden" type="button" class="earlier" @click="loadEarlier">
          Показать ранние запросы · скрыто {{ hidden }}
        </button>
        <AgentTurn
          v-for="(turn, offset) in shown"
          :key="turn.id"
          :turn="turn"
          :busy="busy"
          :last="firstShown + offset === turns.length - 1"
          :copied="copied === turn.id"
          :chat-usage="chatUsage.get(turn.id)"
          :faded="editFrom >= 0 && firstShown + offset >= editFrom"
          :root="projectRoot"
          :can-revert="canRevert(turn.id)"
          :promoted-form="
            turn.role === 'assistant' && turn.id === turns.at(-1)?.id ? originalForm : undefined
          "
          :lens="turn.role === 'assistant' && turn.id === turns.at(-1)?.id ? lens : undefined"
          @copy="copyMessage"
          @open="openChip"
          @edit="editMessage"
          @form-submit="submitTurnForm"
          @rewind="askRewind"
          @retry="retryMessage"
          @fork="forkMessage"
          @continue="continueTurn"
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
      :selection="selection"
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
      <button v-if="away" type="button" class="latest-button" @click="toBottom">
        <IconArrowDown aria-hidden="true" />К последнему сообщению
      </button>
      <div v-if="jobsState.hasRequests" class="requests">
        <AgentPermissions :permissions="permissions" @decide="decide" />
        <AgentQuestions :requests="questions" @answer="answer" />
        <AgentSecrets :requests="secrets" @answer="answerSecret" />
        <AgentJobRequests v-if="!plain" :jobs="jobsState.jobs" @answered="jobsState.refresh" />
      </div>
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
      <AgentSideQuestion v-if="side.state.open" :side="side" />
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
      <AgentActivityDock
        :jobs="jobsState.jobs"
        :tasks="tasks"
        :plan="plan"
        :queue="queue"
        :busy="busy"
        :can-inject="!!capabilities.inject"
        :viewing-task="viewingTask"
        :project-id="projectId"
        :backend="backend"
        :selection="selection"
        @open="jobsState.open"
        @view="viewTask"
        @tab="taskInTab"
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
      :started-at="turns.findLast((turn) => turn.role === 'assistant')?.at"
      :error="error || copyError"
      :copied="!!copied"
      :form="pendingForm"
      :editing="!!editing"
      @submit="submit"
      @form-submit="submitComposerForm"
      @open="openChip"
      @fail="(message) => (error = message)"
      @dismiss="dismissError"
      @stop="stop"
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
.chat-drop-hint {
  position: absolute;
  inset: 6px;
  z-index: 20;
  display: grid;
  place-items: center;
  border: 2px dashed var(--accent, currentColor);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  color: var(--text, inherit);
  font-size: 14px;
  pointer-events: none;
}
.agent-chat {
  --chat-width: 680px;
  min-width: 0;
  background: var(--bg);
  container-type: inline-size;
  position: relative;
}
.chat-tools {
  flex: none;
  width: 100%;
  max-width: calc(var(--chat-width) + 56px);
  margin: 0 auto;
  padding: var(--sp-2) var(--sp-5) 0;
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
  display: grid;
  gap: var(--sp-2);
  width: 100%;
  max-width: calc(var(--chat-width) + 56px);
  margin: 0 auto;
  padding: 0 var(--sp-5);
  flex-shrink: 0;
}
.dock > * {
  margin-bottom: 0;
}
.requests {
  display: grid;
  gap: var(--sp-2);
  max-height: min(45vh, 420px);
  overflow-y: auto;
  scrollbar-width: thin;
}
.compact-hint {
  margin: 0 0 var(--sp-2);
  color: var(--warn);
  font-size: var(--fs-2xs);
}
.compact-hint.urgent {
  color: var(--err);
}
.latest-button {
  position: absolute;
  left: 50%;
  bottom: calc(100% + var(--sp-2));
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px var(--sp-3);
  border-radius: var(--r-full);
  border: 1px solid var(--line);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: var(--fs-2xs);
  white-space: nowrap;
}
.latest-button svg {
  width: 12px;
  height: 12px;
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
.chat-loading {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.chat-loading svg {
  width: 16px;
  height: 16px;
}
.earlier {
  display: block;
  margin: 0 auto var(--sp-4);
  padding: var(--sp-1) var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-2xs);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.earlier:hover {
  color: var(--text);
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
