<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import type { AgentTurn } from "../model/types.ts";
import AgentMessage from "./AgentMessage.vue";
import AgentActivity from "./AgentActivity.vue";
import IconBot from "~icons/lucide/bot";
import IconCopy from "~icons/lucide/copy";
import IconCheck from "~icons/lucide/check";

defineProps<{ turn: AgentTurn; busy: boolean; last: boolean; copied: boolean }>();
const emit = defineEmits<{ copy: [id: string, text: string] }>();
</script>

<template>
  <article class="turn" :class="turn.role">
    <template v-if="turn.role === 'user'">
      <span class="user-label">Вы</span>
      <p class="user-message">{{ turn.text }}</p>
    </template>
    <template v-else>
      <div class="assistant-heading">
        <span class="avatar"><IconBot aria-hidden="true" /></span>
        <span class="sender">Projector</span>
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
      <div class="assistant-body">
        <div v-if="busy && last && !turn.text" class="thinking" role="status">
          <span class="thinking-dots" aria-hidden="true"><i /><i /><i /></span
          >{{ turn.tools.some((t) => t.status === "running") ? "Выполняет задачу" : "Думает" }}
        </div>
        <AgentActivity v-if="turn.tools.length" :tools="turn.tools" />
        <AgentMessage v-if="turn.text" :text="turn.text" />
      </div>
    </template>
  </article>
</template>

<style scoped>
.turn {
  min-width: 0;
  margin-bottom: 30px;
}
.turn:last-child {
  margin-bottom: 0;
}
.user {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  padding-left: 38px;
}
.user-label {
  font-size: var(--fs-2xs);
  color: var(--muted);
  margin: 0 3px 7px;
}
.user-message {
  max-width: 90%;
  margin: 0;
  padding: 13px 17px;
  border: 1px solid var(--line);
  border-radius: var(--r-lg) 12px 3px 12px;
  background: var(--bg-3);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.assistant-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 28px;
  margin-bottom: 10px;
}
.avatar {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-lg);
  border: 1px solid var(--line);
  background: var(--bg-3);
  color: var(--text-2);
  flex-shrink: 0;
}
.avatar svg {
  width: 16px;
  height: 16px;
  stroke-width: 1.6;
}
.sender {
  font-size: var(--fs-2xs);
  font-weight: 600;
  color: var(--text);
}
.copy-button {
  margin-left: auto;
  opacity: 0.45;
}
.assistant:hover .copy-button,
.copy-button:focus-visible,
.copy-button.copied {
  opacity: 1;
}
.copy-button.copied {
  color: var(--run);
}
.assistant-body {
  padding-left: 38px;
  min-width: 0;
}
.thinking {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--fs-xs);
  color: var(--muted);
  padding: 7px 0;
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
  .assistant-body {
    padding-left: 0;
  }
  .user {
    padding-left: 15px;
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
