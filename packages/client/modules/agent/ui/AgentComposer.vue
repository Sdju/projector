<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import UiInline from "../../../common/ui/UiInline.vue";
import type { MessageChip, MessagePart } from "../model/types.ts";
import AgentInput from "./AgentInput.vue";
import AgentFormPanel from "./AgentFormPanel.vue";
import AgentWorkClock from "./AgentWorkClock.vue";
import AgentQuote from "./AgentQuote.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import IconArrowUp from "~icons/lucide/arrow-up";
import IconSquare from "~icons/lucide/square";
import IconAlert from "~icons/lucide/circle-alert";
import IconType from "~icons/lucide/type";
import IconListChecks from "~icons/lucide/list-checks";
import IconRefresh from "~icons/lucide/refresh-cw";
import IconX from "~icons/lucide/x";

const draft = defineModel<string>({ required: true });
const parts = defineModel<MessagePart[]>("parts", { default: () => [] });
const props = defineProps<{
  busy: boolean;
  /** When the answer in progress began, for the clock beside the input. */
  startedAt?: number;
  error: string;
  copied: boolean;
  projectId?: string;
  /** The chat log whose selection can be quoted into the draft. */
  quoteRoot?: HTMLElement;
  commands?: { name: string; description?: string }[];
  /** The form the last answer ended with: it takes the place of the text field. */
  form?: string;
  /** A message is being edited: the text field wins over the pending form. */
  editing?: boolean;
  /** The last answer failed and the same request can be sent again. */
  retryable?: boolean;
}>();
const emit = defineEmits<{
  submit: [];
  stop: [];
  open: [chip: MessageChip];
  fail: [message: string];
  dismiss: [];
  retry: [];
  formSubmit: [text: string, data: unknown, summary: string | undefined, source: string];
}>();
// A long error (a validation dump, a stack) stays a short strip until asked to open.
const expanded = ref(false);
const long = computed(() => props.error.length > 160 || props.error.includes("\n"));
watch(
  () => props.error,
  () => (expanded.value = false),
);
// The answer form is the composer until the user asks for the text field; a new form opens again.
const dismissed = ref("");
watch(
  () => props.form,
  (source, previous) => {
    if (source && source !== previous) dismissed.value = "";
  },
);
// A new answer always offers its form, even when it is the same markup as the previous one.
watch(
  () => props.busy,
  (busy, was) => {
    if (was && !busy) dismissed.value = "";
  },
);
const formOpen = computed(
  () => !!props.form && !props.busy && !props.editing && dismissed.value !== props.form,
);
const activeForm = computed(() => (formOpen.value ? props.form : undefined));
function dismissForm() {
  dismissed.value = props.form ?? "";
}
function restoreForm() {
  if (props.form) dismissed.value = "";
}
function submitForm(text: string, data: unknown, summary?: string) {
  const source = props.form;
  if (!source) return;
  dismissed.value = source;
  emit("formSubmit", text, data, summary, source);
}
const input = ref<InstanceType<typeof AgentInput>>();
const formPanel = ref<InstanceType<typeof AgentFormPanel>>();
const formSubmittable = ref(false);
watch(
  () => formOpen.value,
  (open) => {
    if (!open) formSubmittable.value = false;
  },
);
watch(activeForm, () => (formSubmittable.value = false));
function submitActive() {
  if (formOpen.value) {
    formPanel.value?.submit();
    return;
  }
  emit("submit");
}
/** Adds chips to the end of the draft; a form gives way to the text field so they are visible. */
async function attach(chips: MessageChip[]) {
  dismissForm();
  await nextTick();
  input.value?.appendChips(chips);
}
/** Adds selected text to the end of the draft; a form gives way to the text field. */
async function appendText(text: string) {
  dismissForm();
  await nextTick();
  input.value?.appendText(text);
}
/** Puts a quote into the draft at the cursor; a form gives way to the text field. */
async function quote(text: string) {
  dismissForm();
  await nextTick();
  input.value?.insertQuote(text);
}
defineExpose({
  focus: () => {
    if (!formOpen.value) input.value?.focus();
  },
  attach,
  appendText,
  quote,
  acceptsDrag: (data: DataTransfer | null) => !!input.value?.acceptsDrag(data),
  dropData: (data: DataTransfer) => !!input.value?.dropData(data),
  showForm: restoreForm,
  hideForm: dismissForm,
});
</script>

<template>
  <div class="composer-area">
    <div v-if="error" class="chat-error" role="alert">
      <IconAlert aria-hidden="true" />
      <p class="chat-error-text" :class="{ clamped: long && !expanded, open: expanded }">
        {{ error }}
      </p>
      <button v-if="long" type="button" class="chat-error-toggle" @click="expanded = !expanded">
        {{ expanded ? "Свернуть" : "Развернуть" }}
      </button>
      <button
        v-if="retryable && !busy"
        type="button"
        class="chat-error-retry"
        title="Повторить ответ"
        aria-label="Повторить ответ"
        @click="emit('retry')"
      >
        <IconRefresh aria-hidden="true" />
      </button>
      <button
        type="button"
        class="chat-error-close"
        title="Скрыть"
        aria-label="Скрыть ошибку"
        @click="emit('dismiss')"
      >
        <IconX aria-hidden="true" />
      </button>
    </div>
    <AgentQuote :root="quoteRoot" @quote="quote" />
    <form
      class="composer"
      :class="{ working: busy, 'form-mode': formOpen }"
      @submit.prevent="submitActive"
    >
      <div v-if="activeForm" class="composer-form">
        <AgentFormPanel
          ref="formPanel"
          composer
          :source="activeForm"
          :project-id="projectId"
          @submit="submitForm"
          @submittable="formSubmittable = $event"
        />
      </div>
      <AgentInput
        v-show="!formOpen"
        ref="input"
        v-model="draft"
        v-model:parts="parts"
        :project-id="projectId"
        :commands="commands"
        @submit="emit('submit')"
        @open="(chip) => emit('open', chip)"
        @fail="(message) => emit('fail', message)"
      />
      <UiInline class="composer-footer" justify="normal">
        <slot name="controls" />
        <UiInline class="footer-end" justify="normal">
          <UiButton
            v-if="form && !editing"
            shape="icon"
            size="sm"
            class="form-toggle"
            :title="formOpen ? 'Переключиться на текст' : 'Открыть форму ответа'"
            :aria-label="formOpen ? 'Переключиться на текст' : 'Открыть форму ответа'"
            :aria-pressed="formOpen"
            @click="formOpen ? dismissForm() : restoreForm()"
          >
            <IconType v-if="formOpen" aria-hidden="true" />
            <IconListChecks v-else aria-hidden="true" />
          </UiButton>
          <AgentWorkClock v-if="busy && startedAt" :started-at="startedAt" />
          <slot name="status" />
          <button
            v-if="busy"
            type="button"
            class="send-button stop-button"
            title="Остановить"
            aria-label="Остановить"
            @click="emit('stop')"
          >
            <IconSquare aria-hidden="true" />
          </button>
          <button
            v-if="!busy || draft.trim()"
            type="submit"
            class="send-button"
            :title="
              formOpen
                ? formSubmittable
                  ? 'Отправить форму'
                  : 'Сначала отправьте форму'
                : busy
                  ? 'В очередь: уйдёт, когда агент закончит (Enter)'
                  : 'Отправить (Enter)'
            "
            :aria-label="
              formOpen
                ? formSubmittable
                  ? 'Отправить форму'
                  : 'Отправка недоступна, пока открыта форма'
                : busy
                  ? 'Поставить сообщение в очередь'
                  : 'Отправить сообщение'
            "
            :disabled="formOpen ? !formSubmittable : !draft.trim()"
          >
            <IconArrowUp aria-hidden="true" />
          </button>
        </UiInline>
      </UiInline>
    </form>
    <span class="u-sr-only" role="status">{{ copied ? "Ответ скопирован" : "" }}</span>
  </div>
</template>

<style scoped>
.composer-area {
  width: 100%;
  max-width: calc(var(--chat-width) + 56px);
  margin: 0 auto;
  flex-shrink: 0;
  padding: var(--sp-2) var(--sp-5) var(--sp-4);
  position: relative;
}
.composer {
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--bg-2);
  padding: 2px var(--sp-1) var(--sp-1);
  transition:
    border-color var(--t-fast),
    box-shadow var(--t-fast);
}
.composer:focus-within {
  border-color: var(--focus);
}
.composer.form-mode {
  padding: 2px var(--sp-2) var(--sp-1);
}
.composer-form {
  display: grid;
  gap: var(--sp-1);
  min-width: 0;
  max-height: min(46vh, 460px);
  overflow: auto;
  padding: var(--sp-3) 0 var(--sp-2);
  border-bottom: 1px solid var(--line);
  scrollbar-width: thin;
}
.composer-form :deep(.widget > .ui-card) {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.composer-form :deep(.widget) {
  margin: 0;
}
/* Form mode has a wider composer padding, so the footer only compensates its left inset.
   The vertical padding stays zero: the footer box and its buttons must not move between modes. */
.composer.form-mode .composer-footer {
  padding: 0 0 0 var(--sp-2);
}
.form-toggle {
  color: var(--muted);
}
.form-toggle:hover:not(:disabled) {
  color: var(--text);
}
.composer-footer {
  padding: 0 var(--sp-1) 0 var(--sp-3);
  min-height: var(--control-h-sm);
}
.footer-end {
  margin-left: auto;
}
.send-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: var(--r-md);
  color: var(--bg);
  background: var(--text);
  transition: background var(--t-fast);
}
.send-button svg {
  width: 15px;
  height: 15px;
  stroke-width: 2;
}
.send-button:hover:not(:disabled) {
  background: var(--text-2);
}
.send-button:disabled {
  background: var(--bg-4);
  color: var(--muted);
  cursor: default;
}
.stop-button {
  background: var(--text);
}
.stop-button svg {
  width: 10px;
  height: 10px;
  fill: currentColor;
}
.chat-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--err) 40%, var(--bg-2));
  border-radius: var(--r-lg);
  padding: 10px 12px;
  background: color-mix(in srgb, var(--err) 12%, var(--bg-2));
  color: var(--err);
  font-size: var(--fs-2xs);
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
.chat-error-text {
  flex: 1;
  min-width: 0;
  margin: 0;
}
.chat-error-text.clamped {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.chat-error-text.open {
  max-height: 40vh;
  overflow: auto;
}
.chat-error button {
  flex-shrink: 0;
  color: inherit;
  opacity: 0.8;
}
.chat-error button:hover {
  opacity: 1;
}
.chat-error-toggle {
  text-decoration: underline;
  font-size: inherit;
}
.chat-error-close {
  display: grid;
  place-items: center;
}
.chat-error-retry {
  display: grid;
  place-items: center;
}
@container (max-width: 500px) {
  .composer-area {
    padding: var(--sp-2) var(--sp-3) var(--sp-3);
  }
}
</style>
