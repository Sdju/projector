<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import IconArrowUp from "~icons/lucide/arrow-up";
import IconArrowDown from "~icons/lucide/arrow-down";
import IconSquare from "~icons/lucide/square";
import IconFolder from "~icons/lucide/folder";
import IconAlert from "~icons/lucide/circle-alert";

const draft = defineModel<string>({ required: true });
defineProps<{
  busy: boolean;
  away: boolean;
  error: string;
  copied: boolean;
  projectName: string;
}>();
const emit = defineEmits<{ submit: []; stop: []; latest: [] }>();
const input = ref<HTMLTextAreaElement>();
function resize() {
  if (!input.value) return;
  input.value.style.height = "auto";
  input.value.style.height = `${Math.min(input.value.scrollHeight, 180)}px`;
}
function keydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !event.repeat) {
    event.preventDefault();
    emit("submit");
  }
}
watch(draft, async () => {
  await nextTick();
  resize();
});
onMounted(resize);
defineExpose({ resize, focus: () => input.value?.focus() });
</script>

<template>
  <div class="composer-area">
    <button v-if="away" type="button" class="latest-button" @click="emit('latest')">
      <IconArrowDown aria-hidden="true" />К последнему сообщению
    </button>
    <p v-if="error" class="chat-error" role="alert"><IconAlert aria-hidden="true" />{{ error }}</p>
    <form class="composer" :class="{ working: busy }" @submit.prevent="emit('submit')">
      <textarea
        ref="input"
        v-model="draft"
        name="agent-message"
        aria-label="Сообщение агенту"
        placeholder="Что нужно сделать в проекте?"
        rows="1"
        @keydown="keydown"
      />
      <div class="composer-footer">
        <span class="composer-context"
          ><IconFolder aria-hidden="true" /><span>{{ projectName }}</span></span
        >
        <span class="input-hint"
          ><kbd>Enter</kbd> отправить<span> · <kbd>Shift ↵</kbd> новая строка</span></span
        >
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
          title="Отправить сообщение"
          aria-label="Отправить сообщение"
          :disabled="!draft.trim()"
        >
          <IconArrowUp aria-hidden="true" />
        </button>
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
  padding: 8px 28px 20px;
  position: relative;
}
.composer {
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
  background: var(--bg-2);
  padding: 3px 4px 5px;
  box-shadow: var(--shadow-popover);
  transition:
    border-color var(--t-fast),
    box-shadow var(--t-fast);
}
.composer:focus-within {
  border-color: var(--focus);
}
.composer textarea {
  display: block;
  width: 100%;
  min-height: 53px;
  max-height: 180px;
  padding: 14px 13px 8px;
  background: none;
  border: 0;
  border-radius: 0;
  outline: none;
  resize: none;
  font: var(--fs-sm)/1.7 var(--sans);
  color: var(--text);
  scrollbar-width: thin;
}
.composer textarea::placeholder {
  color: var(--muted);
}
.composer-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 7px 1px 12px;
  min-height: 34px;
}
.composer-context {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 30%;
  font: var(--fs-2xs) var(--mono);
  color: var(--muted);
}
.composer-context svg {
  width: 11px;
  height: 11px;
  flex-shrink: 0;
}
.composer-context span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.input-hint {
  margin-left: auto;
  font-size: var(--fs-2xs);
  color: var(--faint);
  white-space: nowrap;
}
kbd {
  font-family: inherit;
  color: var(--muted);
}
.send-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 31px;
  height: 31px;
  flex-shrink: 0;
  border-radius: var(--r-lg);
  color: var(--faint);
  background: var(--text);
  transition:
    background var(--t-fast),
    transform var(--t-fast);
}
.send-button svg {
  width: 18px;
  height: 18px;
  stroke-width: 2;
}
.send-button:hover:not(:disabled) {
  background: var(--text-2);
  transform: translateY(-1px);
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
  width: 11px;
  height: 11px;
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
  padding: 8px 12px;
  border-radius: var(--r-lg);
  border: 1px solid var(--line-strong);
  background: var(--bg-3);
  color: var(--text-2);
  font-size: var(--fs-2xs);
  white-space: nowrap;
  box-shadow: var(--shadow-popover);
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
    padding: 8px 16px 16px;
  }
  .input-hint > span {
    display: none;
  }
}
@container (max-width: 300px) {
  .input-hint {
    display: none;
  }
  .send-button {
    margin-left: auto;
  }
  .composer-context {
    max-width: 70%;
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
