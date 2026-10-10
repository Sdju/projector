<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useIdeCommands } from "../../ide/index.ts";
import { workspaceRequest } from "../../workspace-api/index.ts";
import { agentCommandHandler } from "../model/commands.ts";
import { agentLabel, guiPrograms } from "../model/modes.ts";
import { useAgent } from "../model/session.ts";
import { readoutLines, useTabReadout } from "../../../common/utilities/tab-readout.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import AgentWelcome from "./AgentWelcome.vue";
import AgentTurn from "./AgentTurn.vue";
import AgentComposer from "./AgentComposer.vue";
import AgentPermissions from "./AgentPermissions.vue";
import AgentContextMeter from "./AgentContextMeter.vue";
import AgentChipPreview from "./AgentChipPreview.vue";
import AgentControls from "./AgentControls.vue";
import AgentSessions from "./AgentSessions.vue";
import AgentPlan from "./AgentPlan.vue";
import AgentQueue from "./AgentQueue.vue";
import AgentRewind from "./AgentRewind.vue";
import { chatMarkdown } from "../lib/export.ts";
import { latestPlan } from "../lib/plan.ts";
import { fetchMcpServers, type RewindSummary } from "../api/client.ts";
import { activateChat, registerChat, type ChatController } from "../model/chat-registry.ts";
import type {
  AgentBackendId,
  AgentControl,
  AgentPermissionMode,
  MessageChip,
  RewindScope,
} from "../model/types.ts";
import IconSquarePen from "~icons/lucide/square-pen";
import IconDownload from "~icons/lucide/download";

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
  draftParts,
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
  loadCommands,
  commands: slashCommands,
  setControl,
  loadSessions,
  changeSession,
  resumeSession,
  send,
  queue,
  sendQueuedNow,
  removeQueued,
  edit,
  retry,
  showVersion,
  canRewindFiles,
  rewindFiles,
  clear,
  stop,
  attach,
  release,
  decide,
} = useAgent(props.projectId, plain.value ? undefined : agentCommandHandler(api, props.projectId), {
  backend: props.backend,
  chatId: props.chatId,
});
onMounted(() => {
  void loadControls();
  void loadCommands();
});
const PERMISSION_CONTROL = "permission-mode";
const permissionOptions: { value: AgentPermissionMode; name: string; description: string }[] = [
  { value: "default", name: "Спрашивать", description: "Запрос перед правками и командами" },
  {
    value: "plan",
    name: "План",
    description: "Агент сначала составляет план без правок и ждёт вашего согласия",
  },
  {
    value: "acceptEdits",
    name: "Правки без вопросов",
    description: "Файлы меняются сразу, команды — по запросу",
  },
  {
    value: "auto",
    name: "Авто",
    description: "Классификатор сам разрешает безопасное и спрашивает о рискованном",
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
const root = ref<HTMLElement>();

// The project folder: edited files and dropped paths are shown relative to it.
const projectRoot = ref("");
void workspaceRequest<{ root: string }>(props.projectId, "root")
  .then((data) => {
    projectRoot.value = data.root;
  })
  .catch(() => {});

const plan = computed(() => latestPlan(turns.value.at(-1)));
const contextShare = computed(() =>
  latestContext.value ? latestContext.value.used / Math.max(1, latestContext.value.size) : 0,
);

// Rolling back to a message: the panel asks what to undo, shows what the files would change, then does it.
const rewinding = ref<{ id: string; scope: RewindScope } | null>(null);
const rewindPreview = ref<RewindSummary>();
const rewindPreviewError = ref("");
const rewindResult = ref<RewindSummary>();
const rewindWorking = ref(false);
function askRewind(id: string, scope: RewindScope = "conversation") {
  rewinding.value = { id, scope };
  rewindPreview.value = undefined;
  rewindPreviewError.value = "";
  rewindResult.value = undefined;
}
async function previewRewind(scope: RewindScope) {
  const target = rewinding.value;
  if (!target) return;
  target.scope = scope;
  if (scope === "conversation" || rewindPreview.value || rewindPreviewError.value) return;
  try {
    rewindPreview.value = await rewindFiles(target.id, true);
  } catch (cause) {
    rewindPreviewError.value =
      cause instanceof Error ? cause.message : "Не удалось посчитать откат";
  }
}
/** Does the rollback; used by the panel and by `ide.agent.chat.rewind`. */
async function rewindTo(id: string, scope: RewindScope): Promise<RewindSummary | undefined> {
  let result: RewindSummary | undefined;
  if (scope !== "conversation") result = await rewindFiles(id, false);
  if (scope !== "files" && (!result || result.ok)) edit(id);
  return result;
}
async function confirmRewind(scope: RewindScope) {
  const target = rewinding.value;
  if (!target || rewindWorking.value) return;
  rewindWorking.value = true;
  try {
    const result = await rewindTo(target.id, scope);
    // A real rewind reports no file list; the preview already told which files it changes.
    if (result)
      rewindResult.value = {
        ...result,
        files: result.files.length ? result.files : (rewindPreview.value?.files ?? []),
      };
    else rewinding.value = null;
    if (scope !== "files") await nextTick();
    composer.value?.focus();
  } catch (cause) {
    rewindResult.value = {
      ok: false,
      files: [],
      error: cause instanceof Error ? cause.message : "Не удалось откатить",
    };
  } finally {
    rewindWorking.value = false;
  }
}
function closeRewind() {
  rewinding.value = null;
  rewindResult.value = undefined;
}
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

async function compact() {
  void toBottom();
  await send("/compact");
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
  queue: () => queue.value,
  controls: () => controls.value,
  setControl,
  loadSessions,
  resumeSession,
  toggleControlsMenu: () => controlsMenu.value?.toggle(),
  send: (text) => send(text),
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
  <section
    ref="root"
    class="agent-chat"
    aria-label="Чат с агентом"
    @focusin="activateChat(controller)"
    @pointerdown.capture="activateChat(controller)"
  >
    <div class="chat-tools">
      <AgentSessions
        v-if="plain"
        :sessions="sessions"
        :loading="sessionsLoading"
        :error="sessionsError"
        :disabled="busy"
        :active="activeSession"
        :editable="claude"
        @open="loadSessions"
        @change="changeSession"
        @pick="(id) => void resumeSession(id).catch(() => {})"
      />
      <UiButton
        v-if="turns.length"
        icon
        size="sm"
        title="Сохранить чат в Markdown"
        aria-label="Сохранить чат в Markdown"
        @click="downloadChat"
      >
        <IconDownload aria-hidden="true" />
      </UiButton>
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
    <div class="dock">
      <AgentPermissions :permissions="permissions" @decide="decide" />
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
      <AgentPlan :items="plan" :busy="busy" />
      <p v-if="claude && contextShare >= 0.8 && !busy" class="compact-hint" role="status">
        Контекст заполнен на {{ Math.round(contextShare * 100) }}%.
        <button type="button" @click="compact">Сжать</button>
      </p>
      <AgentQueue :items="queue" :busy="busy" @now="sendQueuedNow" @remove="removeQueued" />
    </div>
    <AgentComposer
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
      @stop="stop"
      @latest="toBottom"
    >
      <template v-if="latestContext" #status>
        <AgentContextMeter :context="latestContext" />
      </template>
      <template v-if="plain" #controls>
        <AgentControls
          ref="controlsMenu"
          :controls="allControls"
          :disabled="busy"
          @change="changeControl"
        />
      </template>
    </AgentComposer>
    <AgentChipPreview :project-id="projectId" :scope="root" />
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
.dock {
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
