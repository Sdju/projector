<script setup lang="ts">
import { ref } from "vue";
import type { MessageChip, MessagePart } from "../model/types.ts";
import AgentInput from "./AgentInput.vue";
import IconArrowUp from "~icons/lucide/arrow-up";
import IconArrowDown from "~icons/lucide/arrow-down";
import IconSquare from "~icons/lucide/square";
import IconAlert from "~icons/lucide/circle-alert";

const draft = defineModel<string>({ required: true });
const parts = defineModel<MessagePart[]>("parts", { default: () => [] });
defineProps<{
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
}>();
const input = ref<InstanceType<typeof AgentInput>>();
defineExpose({ resize: () => {}, focus: () => input.value?.focus() });
</script>

<template>
  <div class="composer-area">
    <button v-if="away" type="button" class="latest-button" @click="emit('latest')">
      <IconArrowDown aria-hidden="true" />К последнему сообщению
    </button>
    <p v-if="error" class="chat-error" role="alert"><IconAlert aria-hidden="true" />{{ error }}</p>
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
      <div class="composer-footer">
        <slot name="controls" />
        <div class="footer-end">
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
            v-else
            type="submit"
            class="send-button"
            title="Отправить (Enter)"
            aria-label="Отправить сообщение"
            :disabled="!draft.trim()"
          >
            <IconArrowUp aria-hidden="true" />
          </button>
        </div>
      </div>
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
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--sp-1) 0 var(--sp-3);
  min-height: var(--control-h-sm);
}
.footer-end {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
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
