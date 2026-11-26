<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { computed, inject } from "vue";
import { zenMode } from "../../../common/utilities/zen-mode.ts";
import { chatProjectKey } from "../../chat-images/index.ts";
import { type ForkMode } from "../../agent-core/index.ts";
import { failureTitle, isAgentFailure } from "@ai-projector/core/modules/agent-failure/index.ts";
import type { AgentLens } from "../model/lens.ts";
import type { AgentTurn, ChatUsage, MessageChip } from "../../agent-core/index.ts";
import type { AgentDoctorProgress, AgentDoctorReport } from "../../agent-core/index.ts";
import { segmentsOf } from "../model/turn-segments.ts";
import { useTurnStamp } from "../model/turn-stamp.ts";
import AgentUserTurn from "./AgentUserTurn.vue";
import AgentMessage from "./AgentMessage.vue";
import AgentDoctorNote from "./AgentDoctorNote.vue";
import AgentLensView from "./AgentLens.vue";
import AgentWork from "./AgentWork.vue";
import AgentChanges from "./AgentChanges.vue";
import AgentUsageInfo from "./AgentUsageInfo.vue";

const projectId = inject(chatProjectKey, "");
const props = defineProps<{
  turn: AgentTurn;
  /** Tokens and cost of the chat up to this answer. */
  chatUsage?: ChatUsage;
  /** The project folder, to show edited files relative to it. */
  root?: string;
  /** The form block the chat owns: the composer shows the active one, the user's snapshot the sent one. */
  promotedForm?: string;
  /** The chat's Lens: only the last work group of the last answer shows it. */
  lens?: AgentLens;
  /** What Answer Doctor did with this answer, when it changed the visible markup. */
  doctor?: AgentDoctorReport;
  /** What Answer Doctor is doing right now; absent until the check finds a problem. */
  doctorLive?: AgentDoctorProgress;
  /** The chat will continue this answer when its quota resets. */
  resumeScheduled?: boolean;
  /** Per-render state of the turn; `busy`, `last` and `copied` default to false. */
  flags?: {
    busy?: boolean;
    last?: boolean;
    copied?: boolean;
    /** What an edit in progress is about to replace. */
    faded?: boolean;
    /** Files can be taken back to before the request this answer belongs to. */
    canRevert?: boolean;
    /** A conversation only to read (a subagent's): no editing, retrying or rolling back. */
    readonly?: boolean;
    /** The form was already sent: the user's snapshot shows it, so this copy is hidden. */
    formAnswered?: boolean;
    /** What the chat is doing now: `compacting` is shown while the context is summarized. */
    phase?: string;
  };
}>();
const emit = defineEmits<{
  copy: [id: string, text: string];
  open: [chip: MessageChip];
  edit: [id: string];
  formSubmit: [id: string, text: string, data: unknown, summary?: string];
  rewind: [id: string];
  retry: [id: string];
  /** Schedule (or cancel) the continuation of an answer stopped on a usage limit. */
  quotaResume: [id: string];
  /** A new chat from this point: before a question (with it in the input) or after an answer. */
  fork: [id: string, mode: ForkMode];
  continue: [];
  version: [id: string, target: number];
  openFile: [path: string];
  revert: [id: string];
  /** The doctor mark was clicked: run another repair attempt for this answer. */
  doctorRetry: [id: string];
}>();

const failure = computed(() =>
  isAgentFailure(props.turn.failureInfo) ? props.turn.failureInfo : undefined,
);
const failureText = computed(() => failure.value?.message ?? props.turn.failure ?? "");
const failureTitleText = computed(() => (failure.value ? failureTitle(failure.value) : ""));
/** Only a quota with a future reset shows a time; a passed one is retryable as usual. */
const quotaUntil = computed(() => {
  const resetAt = failure.value?.resetAt;
  if (failure.value?.class !== "usage_limit" || resetAt === undefined || resetAt <= Date.now())
    return "";
  return new Date(resetAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
});
/** A manual repeat is hidden only when the provider explicitly said it cannot work. */
const mayRetry = computed(() => failure.value?.retryable !== false);

const flags = computed(() => ({
  busy: false,
  last: false,
  copied: false,
  faded: false,
  canRevert: false,
  readonly: false,
  formAnswered: false,
  phase: "",
  ...props.flags,
}));
const { written, stamp, stampFull } = useTurnStamp(() => props.turn.at);

const segments = computed(() => segmentsOf(props.turn));

// The "Работа" block shows its own current step; dots only fill an answer with nothing yet.
const waiting = computed(() => segments.value.length === 0);
const anyRunning = computed(() => props.turn.tools.some((tool) => tool.status === "running"));
// A note after the work does not finish it: the last work group is still the one being worked on
// until a text block follows.
const currentWork = computed(() => {
  for (let index = segments.value.length - 1; index >= 0; index--) {
    const segment = segments.value[index]!;
    if (segment.type === "text") return "";
    if (segment.type === "work") return segment.key;
  }
  return "";
});
// The Lens panel belongs to one block: the last work group of the answer.
const lastWork = computed(
  () => segments.value.findLast((segment) => segment.type === "work")?.key ?? "",
);
</script>

<template>
  <article class="turn" :class="[turn.role, { faded: flags.faded, zen: zenMode }]">
    <AgentUserTurn
      v-if="turn.role === 'user'"
      :turn="turn"
      :busy="flags.busy"
      :readonly="flags.readonly"
      :project-id="projectId"
      @open="emit('open', $event)"
      @edit="emit('edit', $event)"
      @form-submit="(...args) => emit('formSubmit', ...args)"
      @rewind="emit('rewind', $event)"
      @fork="(...args) => emit('fork', ...args)"
      @version="(...args) => emit('version', ...args)"
    />
    <div v-else class="assistant-body">
      <template v-for="segment in segments" :key="segment.key">
        <AgentMessage
          v-if="segment.type === 'text'"
          :text="segment.text"
          :streaming="flags.busy && flags.last && segment === segments.at(-1)"
          :promoted="promotedForm"
          :answered="flags.formAnswered"
          :project-id="projectId"
        />
        <p v-else-if="segment.type === 'note'" class="user-message note">{{ segment.text }}</p>
        <AgentWork
          v-else-if="!zenMode"
          :items="segment.items"
          :busy="flags.busy"
          :last="flags.last"
          :current="segment.key === currentWork"
          :any-running="anyRunning"
          :root="root"
          :lens="segment.key === lastWork ? lens : undefined"
          @open="(path) => emit('openFile', path)"
        />
      </template>
      <!-- Until the first thought or call there is no work block: Lens sits by the thinking dots. -->
      <AgentLensView
        v-if="waiting && flags.busy && flags.last && lens && lens.state.open && !zenMode"
        :lens="lens"
        class="early"
      />
      <UiInline
        v-if="
          flags.busy &&
          flags.last &&
          (waiting || (zenMode && !!currentWork) || flags.phase === 'compacting')
        "
        :gap="2"
        justify="normal"
        class="thinking"
        role="status"
      >
        <UiInline
          as="span"
          :gap="0.75"
          align="normal"
          justify="normal"
          class="thinking-dots"
          aria-hidden="true"
          ><i /><i /><i
        /></UiInline>
        {{
          flags.phase === "compacting"
            ? "Сжимаю историю"
            : turn.tools.some((t) => t.status === "running")
              ? "Выполняет задачу"
              : "Думает"
        }}
      </UiInline>
      <AgentChanges
        v-if="(!flags.busy || !flags.last) && !zenMode"
        :tools="turn.tools"
        :root="root ?? ''"
        :can-revert="flags.canRevert === true && !flags.busy && !flags.readonly"
        @open="(path) => emit('openFile', path)"
        @revert="emit('revert', turn.id)"
      />
      <div v-if="turn.failure" class="turn-failure" role="alert">
        <ProjectorIcon name="circle-alert" aria-hidden="true" />
        <div class="turn-failure-body">
          <p v-if="failureTitleText" class="turn-failure-title">
            {{ failureTitleText
            }}<span v-if="quotaUntil">
              · {{ resumeScheduled ? "продолжу в" : "до" }} {{ quotaUntil }}</span
            >
          </p>
          <p class="turn-failure-text">{{ failureText }}</p>
        </div>
        <UiButton
          v-if="quotaUntil"
          size="sm"
          :title="
            resumeScheduled
              ? 'Отменить автоматическое продолжение после сброса квоты'
              : 'Продолжить разговор, когда провайдер снова разрешит запросы'
          "
          @click="emit('quotaResume', turn.id)"
        >
          {{ resumeScheduled ? "Отменить продолжение" : "Продолжить после сброса" }}
        </UiButton>
        <UiButton
          v-if="flags.last && !flags.busy && !flags.readonly && mayRetry"
          size="sm"
          title="Повторить запрос с начала; изменённые файлы не откатываются"
          @click="emit('retry', turn.id)"
        >
          Повторить
        </UiButton>
      </div>
      <UiInline
        v-if="turn.text && !(flags.busy && flags.last) && !flags.readonly && !zenMode"
        :gap="0.5"
        align="normal"
        justify="normal"
        class="turn-footer"
      >
        <UiButton
          shape="icon"
          size="sm"
          class="copy-button"
          title="Продолжить в новом чате: копия разговора до этого ответа"
          aria-label="Продолжить в новом чате"
          @click="emit('fork', turn.id, 'after')"
        >
          <ProjectorIcon name="git-fork" aria-hidden="true" />
        </UiButton>
        <UiButton
          shape="icon"
          size="sm"
          class="copy-button"
          :class="{ copied: flags.copied }"
          :aria-label="flags.copied ? 'Ответ скопирован' : 'Копировать ответ'"
          :title="flags.copied ? 'Скопировано' : 'Копировать ответ'"
          @click="emit('copy', turn.id, turn.text)"
        >
          <ProjectorIcon name="check" v-if="flags.copied" aria-hidden="true" /><ProjectorIcon
            name="copy"
            v-else
            aria-hidden="true"
          />
        </UiButton>
        <UiButton
          v-if="flags.last && !turn.failure"
          shape="icon"
          size="sm"
          class="copy-button"
          title="Повторить: получить другой ответ"
          aria-label="Повторить ответ"
          :disabled="flags.busy"
          @click="emit('retry', turn.id)"
        >
          <ProjectorIcon name="refresh-cw" aria-hidden="true" />
        </UiButton>
        <UiButton
          v-if="flags.last && turn.stopped"
          size="sm"
          title="Ход остановлен на лимите: продолжить с того же места"
          :disabled="flags.busy"
          @click="emit('continue')"
        >
          Продолжить
        </UiButton>
        <AgentUsageInfo
          v-if="turn.usage"
          :usage="turn.usage"
          :chat="chatUsage"
          class="copy-button"
        />
        <AgentDoctorNote
          :report="doctor"
          :live="doctorLive"
          @retry="emit('doctorRetry', turn.id)"
        />
        <time
          v-if="stamp"
          class="turn-time footer-time"
          :title="stampFull"
          :datetime="written?.toISOString()"
          >{{ stamp }}</time
        >
      </UiInline>
    </div>
  </article>
</template>

<style scoped>
.turn {
  min-width: 0;
  margin-bottom: var(--sp-5);
}
.turn.faded {
  opacity: 0.45;
}
.turn:last-child {
  margin-bottom: 0;
}
.user {
  padding-left: var(--sp-6);
}
.user-message {
  max-width: 90%;
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-lg);
  background: var(--bg-3);
  color: var(--text);
  font-size: var(--chat-fs);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.note {
  margin: 0 0 var(--sp-3) auto;
}
.assistant-body {
  min-width: 0;
}
.turn-failure {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid color-mix(in srgb, var(--err) 40%, var(--bg-2));
  border-radius: var(--r-lg);
  background: color-mix(in srgb, var(--err) 10%, var(--theme-inset-background, var(--bg-2)));
  color: var(--err);
  font-size: var(--fs-sm);
  line-height: 1.6;
}
.turn-failure > svg {
  width: 16px;
  height: 16px;
  margin-top: 2px;
  flex-shrink: 0;
}
.turn-failure-text {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.turn-failure-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.turn-failure-title {
  margin: 0;
  font-weight: 600;
}
.turn-failure button {
  flex-shrink: 0;
}
.copy-button {
  display: flex;
  margin-top: var(--sp-1);
  opacity: 0;
  color: var(--muted);
  border-color: transparent;
}
.doctor {
  opacity: 0;
}
.doctor.active,
.assistant:hover .doctor,
.doctor:focus-within {
  opacity: 1;
}
.assistant:hover .copy-button,
.copy-button:focus-visible,
.copy-button:focus-within,
.copy-button.copied {
  opacity: 1;
}
.copy-button.copied {
  color: var(--run);
}
.turn-time {
  align-self: center;
  font-size: var(--fs-2xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.footer-time {
  margin-top: var(--sp-1);
  opacity: 0;
  color: var(--muted);
}
.assistant:hover .footer-time {
  opacity: 1;
}
.thinking {
  font-size: var(--fs-xs);
  color: var(--muted);
  padding: var(--sp-1) 0;
}
.thinking-dots i {
  height: 4px;
  width: 4px;
  background: var(--muted);
  border-radius: 50%;
  animation: pulse 1.2s ease-in-out infinite;
}
.thinking-dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.thinking-dots i:nth-child(3) {
  animation-delay: 0.3s;
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
  .user {
    padding-left: var(--sp-4);
  }
  .user-message {
    max-width: 96%;
  }
}
</style>
