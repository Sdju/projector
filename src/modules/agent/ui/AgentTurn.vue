<script setup lang="ts">
import UiInline from "../../../common/ui/UiInline.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { computed, ref } from "vue";
import { chipIcon, chipLabel, chipTitle } from "../lib/composer/chips.ts";
import { versionsOf, type ForkMode } from "../model/branches.ts";
import { legacyParts } from "../model/turn-events.ts";
import type { AgentToolChip, AgentTurn, ChatUsage, MessageChip } from "../model/types.ts";
import AgentMessage from "./AgentMessage.vue";
import AgentFormAnswer from "./AgentFormAnswer.vue";
import AgentWork, { type AgentWorkItem } from "./AgentWork.vue";
import AgentChanges from "./AgentChanges.vue";
import AgentUsageInfo from "./AgentUsageInfo.vue";
import IconCopy from "~icons/lucide/copy";
import IconCheck from "~icons/lucide/check";
import IconPencil from "~icons/lucide/pencil";
import IconUndo from "~icons/lucide/undo-2";
import IconRefresh from "~icons/lucide/refresh-cw";
import IconGitFork from "~icons/lucide/git-fork";
import IconPrev from "~icons/lucide/chevron-left";
import IconNext from "~icons/lucide/chevron-right";

const props = defineProps<{
  turn: AgentTurn;
  /** Tokens and cost of the chat up to this answer. */
  chatUsage?: ChatUsage;
  busy: boolean;
  last: boolean;
  copied: boolean;
  /** What an edit in progress is about to replace. */
  faded?: boolean;
  /** The project folder, to show edited files relative to it. */
  root?: string;
  /** Files can be taken back to before the request this answer belongs to. */
  canRevert?: boolean;
  /** A conversation only to read (a subagent's): no editing, retrying or rolling back. */
  readonly?: boolean;
  /** The form the chat is waiting for: its copy in this answer is shown as a read-only panel. */
  promotedForm?: string;
}>();
const emit = defineEmits<{
  copy: [id: string, text: string];
  open: [chip: MessageChip];
  edit: [id: string];
  formSubmit: [id: string, text: string, data: unknown, summary?: string];
  rewind: [id: string];
  retry: [id: string];
  /** A new chat from this point: before a question (with it in the input) or after an answer. */
  fork: [id: string, mode: ForkMode];
  continue: [];
  version: [id: string, target: number];
  openFile: [path: string];
  revert: [id: string];
}>();

const versions = computed(() => versionsOf(props.turn));
const formAnswer = ref<InstanceType<typeof AgentFormAnswer>>();
const editTitle = computed(() =>
  props.turn.form ? "Изменить ответ в форме" : "Править и отправить заново",
);
function editMessage() {
  if (props.turn.form) formAnswer.value?.start();
  else emit("edit", props.turn.id);
}
function submitForm(text: string, data: unknown, summary?: string) {
  emit("formSubmit", props.turn.id, text, data, summary);
}

const written = computed(() => (props.turn.at ? new Date(props.turn.at) : undefined));
const stamp = computed(() =>
  written.value?.toLocaleString("ru", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }),
);
const stampFull = computed(() =>
  written.value?.toLocaleString("ru", { dateStyle: "long", timeStyle: "medium" }),
);

type Segment =
  | { key: string; type: "text"; text: string }
  | { key: string; type: "note"; text: string }
  | { key: string; type: "work"; items: AgentWorkItem[] };

// Text, notes and work in the order they happened; thoughts and calls between texts form one
// collapsed "Работа" group, with neighbouring calls shown as one row inside it.
const segments = computed(() => {
  const result: Segment[] = [];
  // Calls a subagent made are shown inside its own call, not among the main ones.
  const known = new Set(props.turn.tools.map((tool) => tool.id));
  const children = new Map<string, AgentToolChip[]>();
  for (const tool of props.turn.tools)
    if (tool.parent && known.has(tool.parent))
      children.set(tool.parent, [...(children.get(tool.parent) ?? []), tool]);
  const byId = new Map(
    props.turn.tools
      .filter((tool) => !tool.parent || !known.has(tool.parent))
      .map((tool) => [tool.id, { ...tool, children: children.get(tool.id) }]),
  );
  const addWork = (index: number, item: AgentWorkItem) => {
    const last = result.at(-1);
    if (last?.type === "work") last.items.push(item);
    else result.push({ key: `w${index}`, type: "work", items: [item] });
  };
  for (const [index, part] of (props.turn.parts ?? legacyParts(props.turn)).entries()) {
    if (part.type === "text") {
      if (part.text.trim()) result.push({ key: `t${index}`, type: "text", text: part.text });
      continue;
    }
    if (part.type === "note") {
      result.push({ key: `n${index}`, type: "note", text: part.text });
      continue;
    }
    if (part.type === "thought") {
      if (part.text.trim()) addWork(index, { key: `r${index}`, type: "thought", text: part.text });
      continue;
    }
    const tool = byId.get(part.id);
    if (!tool) continue;
    const last = result.at(-1);
    if (last?.type === "work") {
      const item = last.items.at(-1);
      if (item?.type === "tools") {
        item.tools.push(tool);
        continue;
      }
    }
    addWork(index, { key: `a${index}`, type: "tools", tools: [tool] });
  }
  return result;
});
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
</script>

<template>
  <article class="turn" :class="[turn.role, { faded }]">
    <div v-if="turn.role === 'user'" class="user-row">
      <UiInline
        v-if="!readonly"
        :gap="0.5"
        justify="normal"
        class="turn-actions"
        :class="{ pinned: versions.count > 1 }"
      >
        <time
          v-if="stamp"
          class="turn-time"
          :title="stampFull"
          :datetime="written?.toISOString()"
          >{{ stamp }}</time
        >
        <UiInline
          as="span"
          gap="none"
          justify="normal"
          v-if="versions.count > 1"
          class="versions"
          role="group"
          aria-label="Версии"
        >
          <UiButton
            shape="icon"
            size="sm"
            title="Предыдущая версия"
            aria-label="Предыдущая версия"
            :disabled="busy || versions.position === 0"
            @click="emit('version', turn.id, versions.position - 1)"
          >
            <IconPrev aria-hidden="true" />
          </UiButton>
          <span class="version-count">{{ versions.position + 1 }} / {{ versions.count }}</span>
          <UiButton
            shape="icon"
            size="sm"
            title="Следующая версия"
            aria-label="Следующая версия"
            :disabled="busy || versions.position === versions.count - 1"
            @click="emit('version', turn.id, versions.position + 1)"
          >
            <IconNext aria-hidden="true" />
          </UiButton>
        </UiInline>
        <UiButton
          shape="icon"
          size="sm"
          class="turn-action"
          :title="editTitle"
          aria-label="Править сообщение"
          :disabled="busy"
          @click="editMessage"
        >
          <IconPencil aria-hidden="true" />
        </UiButton>
        <UiButton
          shape="icon"
          size="sm"
          class="turn-action"
          title="Откатить к этому сообщению"
          aria-label="Откатить к этому сообщению"
          :disabled="busy"
          @click="emit('rewind', turn.id)"
        >
          <IconUndo aria-hidden="true" />
        </UiButton>
        <UiButton
          shape="icon"
          size="sm"
          class="turn-action"
          title="Ответвить в новый чат: копия разговора до этого сообщения, текст останется в поле ввода"
          aria-label="Ответвить в новый чат"
          @click="emit('fork', turn.id, 'before')"
        >
          <IconGitFork aria-hidden="true" />
        </UiButton>
      </UiInline>
      <div v-if="turn.form" class="user-form">
        <AgentFormAnswer
          ref="formAnswer"
          :source="turn.form.source"
          :values="turn.form.values"
          :busy="busy"
          @submit="submitForm"
        />
      </div>
      <p v-else-if="turn.auto" class="user-message auto">
        Продолжение после задания <code>{{ turn.auto }}</code>
      </p>
      <p v-else class="user-message">
        <template v-if="turn.content?.length">
          <template v-for="(part, index) in turn.content" :key="index">
            <template v-if="part.type === 'text'">{{ part.text }}</template>
            <span
              v-else
              class="chip"
              :class="part.type"
              :title="chipTitle(part)"
              :data-chip="JSON.stringify(part)"
              role="button"
              tabindex="0"
              @click="emit('open', part)"
              @keydown.enter="emit('open', part)"
            >
              <span class="chip-icon" aria-hidden="true" v-html="chipIcon(part)" />{{
                chipLabel(part)
              }}</span
            >
          </template>
        </template>
        <template v-else>{{ turn.text }}</template>
      </p>
    </div>
    <div v-else class="assistant-body">
      <template v-for="segment in segments" :key="segment.key">
        <AgentMessage
          v-if="segment.type === 'text'"
          :text="segment.text"
          :streaming="busy && last && segment === segments.at(-1)"
          :promoted="promotedForm"
        />
        <p v-else-if="segment.type === 'note'" class="user-message note">{{ segment.text }}</p>
        <AgentWork
          v-else
          :items="segment.items"
          :busy="busy"
          :last="last"
          :current="segment.key === currentWork"
          :any-running="anyRunning"
          :root="root"
          @open="(path) => emit('openFile', path)"
        />
      </template>
      <UiInline
        v-if="busy && last && waiting"
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
          ><i /><i /><i /></UiInline
        >{{ turn.tools.some((t) => t.status === "running") ? "Выполняет задачу" : "Думает" }}
      </UiInline>
      <AgentChanges
        v-if="!busy || !last"
        :tools="turn.tools"
        :root="root ?? ''"
        :can-revert="canRevert === true && !busy && !readonly"
        @open="(path) => emit('openFile', path)"
        @revert="emit('revert', turn.id)"
      />
      <UiInline
        v-if="turn.text && !(busy && last) && !readonly"
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
          <IconGitFork aria-hidden="true" />
        </UiButton>
        <UiButton
          shape="icon"
          size="sm"
          class="copy-button"
          :class="{ copied: copied }"
          :aria-label="copied ? 'Ответ скопирован' : 'Копировать ответ'"
          :title="copied ? 'Скопировано' : 'Копировать ответ'"
          @click="emit('copy', turn.id, turn.text)"
        >
          <IconCheck v-if="copied" aria-hidden="true" /><IconCopy v-else aria-hidden="true" />
        </UiButton>
        <UiButton
          v-if="last"
          shape="icon"
          size="sm"
          class="copy-button"
          title="Повторить: получить другой ответ"
          aria-label="Повторить ответ"
          :disabled="busy"
          @click="emit('retry', turn.id)"
        >
          <IconRefresh aria-hidden="true" />
        </UiButton>
        <UiButton
          v-if="last && turn.stopped"
          size="sm"
          title="Ход остановлен на лимите: продолжить с того же места"
          :disabled="busy"
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
.user-row {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.turn-actions {
  min-height: var(--control-h-sm);
  opacity: 0;
  color: var(--muted);
}
.user:hover .turn-actions,
.turn-actions:focus-within,
.turn-actions.pinned {
  opacity: 1;
}
.versions {
  font-size: var(--fs-2xs);
  font-variant-numeric: tabular-nums;
}
.user-message {
  max-width: 90%;
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-lg);
  background: var(--bg-3);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.user-form {
  width: min(90%, 640px);
  min-width: 0;
}
.user-form :deep(.ui-card) {
  background: var(--bg-3);
}
.note {
  margin: 0 0 var(--sp-3) auto;
}
.user-message.auto {
  padding: var(--sp-1) 0;
  background: none;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.user-message.auto code {
  font-family: var(--mono);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 0 6px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--bg-2);
  font-size: var(--fs-xs);
  line-height: 1.5;
  vertical-align: baseline;
}
.chip:hover,
.chip:focus-visible {
  border-color: var(--focus);
  color: var(--text);
  cursor: pointer;
}
.chip-icon {
  display: flex;
  color: var(--muted);
}
.chip-icon :deep(.chip-thumb) {
  border-radius: 2px;
  object-fit: cover;
}
.assistant-body {
  min-width: 0;
}
.copy-button {
  display: flex;
  margin-top: var(--sp-1);
  opacity: 0;
  color: var(--muted);
  border-color: transparent;
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
  .user-form {
    width: 100%;
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
