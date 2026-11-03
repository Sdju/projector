<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import AgentMarkdown from "./AgentMarkdown.vue";
import type { SideQuestion } from "../model/side-question.ts";
import IconMessageCircleQuestion from "~icons/lucide/message-circle-question";
import IconX from "~icons/lucide/x";
import IconTrash2 from "~icons/lucide/trash-2";

const props = defineProps<{ side: SideQuestion }>();
const input = ref<HTMLTextAreaElement>();
const thread = ref<HTMLElement>();

const state = props.side.state;
const source = computed(() => {
  const parts = ["Projector", state.meta.provider, state.meta.model].filter(Boolean);
  return parts.length > 1 ? parts.join(" · ") : "Projector · только чтение";
});

function focus() {
  void nextTick(() => input.value?.focus());
}
function send() {
  if (!state.question.trim() || state.busy) return;
  void props.side.ask().catch(() => {});
  void nextTick(() => {
    thread.value?.scrollTo({ top: thread.value.scrollHeight });
  });
}
function keydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}
function close() {
  props.side.close();
}
function clear() {
  props.side.clear();
  focus();
}
watch(
  () => state.open,
  (open) => {
    if (open) focus();
  },
);
watch(
  () => [state.current, state.checks.length, state.exchanges.length],
  () => {
    void nextTick(() => {
      const element = thread.value;
      if (element) element.scrollTop = element.scrollHeight;
    });
  },
);
</script>

<template>
  <section class="side" aria-label="Вопрос в сторону">
    <header class="head">
      <span class="mark" aria-hidden="true"><IconMessageCircleQuestion /></span>
      <div class="titles">
        <strong>Вопрос в сторону</strong>
        <span class="source">{{ source }}</span>
      </div>
      <span class="badge">не в чат</span>
      <UiButton
        v-if="state.exchanges.length"
        shape="icon"
        size="sm"
        title="Очистить историю вопросов"
        aria-label="Очистить историю вопросов"
        @click="clear"
      >
        <IconTrash2 aria-hidden="true" />
      </UiButton>
      <UiButton
        shape="icon"
        size="sm"
        title="Закрыть"
        aria-label="Закрыть вопрос в сторону"
        @click="close"
      >
        <IconX aria-hidden="true" />
      </UiButton>
    </header>
    <div ref="thread" class="thread" aria-live="polite">
      <p v-if="!state.exchanges.length && !state.currentQuestion && !state.busy" class="empty">
        Спросите о текущей работе, не прерывая агента. Ответ читается по видимой переписке и
        состоянию чата, но не попадает в историю.
      </p>
      <article v-for="(item, index) in state.exchanges" :key="index" class="exchange">
        <p class="question">{{ item.question }}</p>
        <AgentMarkdown :text="item.answer" />
      </article>
      <article v-if="state.currentQuestion || state.current || state.busy" class="exchange current">
        <p v-if="state.currentQuestion" class="question">{{ state.currentQuestion }}</p>
        <ul v-if="state.checks.length" class="checks">
          <li v-for="check in state.checks" :key="check.id" :class="check.status">
            <UiSpinner v-if="check.status === 'running'" />
            <span class="dot" v-else aria-hidden="true" />
            <span class="check-name">{{ check.name }}</span>
            <span v-if="check.detail" class="check-detail">{{ check.detail }}</span>
          </li>
        </ul>
        <AgentMarkdown v-if="state.current" :text="state.current" :streaming="state.busy" />
        <p v-else-if="state.busy" class="pending"><UiSpinner /> Смотрю состояние чата…</p>
      </article>
      <p v-if="state.error" class="error" role="alert">{{ state.error }}</p>
    </div>
    <div class="composer">
      <textarea
        ref="input"
        v-model="state.question"
        name="side-question"
        rows="2"
        placeholder="Например: завис ли процесс? какой сейчас статус?"
        aria-label="Вопрос в сторону"
        :disabled="state.busy"
        @keydown="keydown"
      />
      <div class="actions">
        <span class="note">Enter — спросить · Shift+Enter — новая строка</span>
        <UiButton v-if="state.busy" size="sm" @click="props.side.stop()">Остановить</UiButton>
        <UiButton v-else size="sm" :disabled="!state.question.trim()" @click="send">
          Спросить
        </UiButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.side {
  margin: 0 0 var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--bg-2);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--line);
}
.mark {
  display: flex;
  color: var(--text-2);
}
.mark svg {
  width: 15px;
  height: 15px;
}
.titles {
  display: grid;
  min-width: 0;
  gap: 1px;
}
.titles strong {
  font-size: var(--fs-xs);
  font-weight: 600;
}
.source {
  color: var(--faint);
  font-size: var(--fs-2xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  margin-left: auto;
  padding: 1px 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-full);
  color: var(--muted);
  font-size: var(--fs-2xs);
  white-space: nowrap;
}
.thread {
  max-height: min(38vh, 320px);
  overflow: auto;
  padding: var(--sp-3);
  display: grid;
  gap: var(--sp-3);
}
.empty {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: 1.6;
}
.exchange {
  display: grid;
  gap: var(--sp-1);
  padding-bottom: var(--sp-2);
  border-bottom: 1px solid var(--line);
}
.exchange:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}
.question {
  margin: 0;
  color: var(--text-2);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.current {
  border-bottom: 0;
}
.checks {
  display: grid;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.checks li {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.checks .dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ok, var(--text-2));
  flex-shrink: 0;
}
.checks .error .dot {
  background: var(--err);
}
.check-name {
  color: var(--text-2);
  white-space: nowrap;
}
.check-detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pending {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.error {
  margin: 0;
  color: var(--err);
  font-size: var(--fs-xs);
}
.composer {
  display: grid;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3) var(--sp-3);
  border-top: 1px solid var(--line);
}
textarea {
  width: 100%;
  resize: vertical;
  min-height: 44px;
  max-height: 140px;
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg);
  color: var(--text);
  font: var(--fs-xs) / 1.6 var(--sans);
}
textarea:focus {
  outline: none;
  border-color: var(--focus);
}
.actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.note {
  margin-right: auto;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
</style>
