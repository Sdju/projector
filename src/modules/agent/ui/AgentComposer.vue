<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiInline from "../../../common/ui/UiInline.vue";
import type { MessageChip, MessagePart } from "../model/types.ts";
import AgentInput from "./AgentInput.vue";
import IconArrowUp from "~icons/lucide/arrow-up";
import IconArrowDown from "~icons/lucide/arrow-down";
import IconSquare from "~icons/lucide/square";
import IconAlert from "~icons/lucide/circle-alert";
import IconX from "~icons/lucide/x";

const draft = defineModel<string>({ required: true });
const parts = defineModel<MessagePart[]>("parts", { default: () => [] });
const props = defineProps<{
  busy: boolean;
  away: boolean;
  error: string;
  copied: boolean;
  projectId?: string;
  commands?: { name: string; description?: string }[];
}>();
const emit = defineEmits<{
  submit: [];
  stop: [];
  latest: [];
  open: [chip: MessageChip];
  fail: [message: string];
  dismiss: [];
}>();
// A long error (a validation dump, a stack) stays a short strip until asked to open.
const expanded = ref(false);
const long = computed(() => props.error.length > 160 || props.error.includes("\n"));
watch(
  () => props.error,
  () => (expanded.value = false),
);
const input = ref<InstanceType<typeof AgentInput>>();
defineExpose({
  resize: () => {},
  focus: () => input.value?.focus(),
  acceptsDrag: (data: DataTransfer | null) => !!input.value?.acceptsDrag(data),
  dropData: (data: DataTransfer) => !!input.value?.dropData(data),
});
</script>

<template>
  <div class="composer-area">
    <button v-if="away" type="button" class="latest-button" @click="emit('latest')">
      <IconArrowDown aria-hidden="true" />К последнему сообщению
    </button>
    <div v-if="error" class="chat-error" role="alert">
      <IconAlert aria-hidden="true" />
      <p class="chat-error-text" :class="{ clamped: long && !expanded, open: expanded }">
        {{ error }}
      </p>
      <button v-if="long" type="button" class="chat-error-toggle" @click="expanded = !expanded">
        {{ expanded ? "Свернуть" : "Развернуть" }}
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
    <form class="composer" :class="{ working: busy }" @submit.prevent="emit('submit')">
      <AgentInput
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
            :title="busy ? 'В очередь: уйдёт, когда агент закончит (Enter)' : 'Отправить (Enter)'"
            :aria-label="busy ? 'Поставить сообщение в очередь' : 'Отправить сообщение'"
            :disabled="!draft.trim()"
          >
            <IconArrowUp aria-hidden="true" />
          </button>
        </UiInline>
      </UiInline>
    </form>
    <span class="sr-only" role="status">{{ copied ? "Ответ скопирован" : "" }}</span>
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
.latest-button {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 2px);
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
@container (max-width: 500px) {
  .composer-area {
    padding: var(--sp-2) var(--sp-3) var(--sp-3);
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
