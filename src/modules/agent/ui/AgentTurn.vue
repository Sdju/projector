<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import type { AgentTurn } from "../model/types.ts";
import AgentMessage from "./AgentMessage.vue";
import AgentActivity from "./AgentActivity.vue";
import IconCopy from "~icons/lucide/copy";
import IconCheck from "~icons/lucide/check";

defineProps<{
  turn: AgentTurn;
  busy: boolean;
  last: boolean;
  copied: boolean;
}>();
const emit = defineEmits<{ copy: [id: string, text: string] }>();
</script>

<template>
  <article class="turn" :class="turn.role">
    <p v-if="turn.role === 'user'" class="user-message">{{ turn.text }}</p>
    <div v-else class="assistant-body">
      <div v-if="busy && last && !turn.text" class="thinking" role="status">
        <span class="thinking-dots" aria-hidden="true"><i /><i /><i /></span
        >{{ turn.tools.some((t) => t.status === "running") ? "Выполняет задачу" : "Думает" }}
      </div>
      <AgentActivity v-if="turn.tools.length" :tools="turn.tools" />
      <AgentMessage v-if="turn.text" :text="turn.text" />
      <UiButton
        v-if="turn.text"
        icon
        size="sm"
        class="copy-button"
        :class="{ copied: copied }"
        :aria-label="copied ? 'Ответ скопирован' : 'Копировать ответ'"
        :title="copied ? 'Скопировано' : 'Копировать ответ'"
        @click="emit('copy', turn.id, turn.text)"
      >
        <IconCheck v-if="copied" aria-hidden="true" /><IconCopy v-else aria-hidden="true" />
      </UiButton>
    </div>
  </article>
</template>

<style scoped>
.turn {
  min-width: 0;
  margin-bottom: var(--sp-5);
}
.turn:last-child {
  margin-bottom: 0;
}
.user {
  display: flex;
  justify-content: flex-end;
  padding-left: var(--sp-6);
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
.copy-button.copied {
  opacity: 1;
}
.copy-button.copied {
  color: var(--run);
}
.thinking {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--muted);
  padding: var(--sp-1) 0;
}
.thinking-dots {
  display: flex;
  gap: 3px;
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
@media (prefers-reduced-motion: reduce) {
  .agent-chat *,
  .agent-chat *::before {
    animation: none;
    transition: none;
  }
}
</style>
