<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import { computed } from "vue";
import { chipIcon, chipLabel, chipTitle } from "../lib/composer/chips.ts";
import { legacyParts } from "../model/turn-events.ts";
import type { AgentToolChip, AgentTurn } from "../model/types.ts";
import AgentMessage from "./AgentMessage.vue";
import AgentActivity from "./AgentActivity.vue";
import IconCopy from "~icons/lucide/copy";
import IconCheck from "~icons/lucide/check";

const props = defineProps<{
  turn: AgentTurn;
  busy: boolean;
  last: boolean;
  copied: boolean;
}>();
const emit = defineEmits<{ copy: [id: string, text: string] }>();

type Segment =
  | { key: string; type: "text"; text: string }
  | { key: string; type: "tools"; tools: AgentToolChip[] };

// Text and tool calls in the order they happened; neighbouring calls form one group.
const segments = computed(() => {
  const result: Segment[] = [];
  const byId = new Map(props.turn.tools.map((tool) => [tool.id, tool]));
  for (const [index, part] of (props.turn.parts ?? legacyParts(props.turn)).entries()) {
    if (part.type === "text") {
      if (part.text.trim()) result.push({ key: `t${index}`, type: "text", text: part.text });
      continue;
    }
    const tool = byId.get(part.id);
    if (!tool) continue;
    const last = result.at(-1);
    if (last?.type === "tools") last.tools.push(tool);
    else result.push({ key: `a${index}`, type: "tools", tools: [tool] });
  }
  return result;
});
const waiting = computed(() => segments.value.at(-1)?.type !== "text");
</script>

<template>
  <article class="turn" :class="turn.role">
    <p v-if="turn.role === 'user'" class="user-message">
      <template v-if="turn.content?.length">
        <template v-for="(part, index) in turn.content" :key="index">
          <template v-if="part.type === 'text'">{{ part.text }}</template>
          <span v-else class="chip" :class="part.type" :title="chipTitle(part)">
            <span class="chip-icon" aria-hidden="true" v-html="chipIcon(part)" />{{
              chipLabel(part)
            }}</span
          >
        </template>
      </template>
      <template v-else>{{ turn.text }}</template>
    </p>
    <div v-else class="assistant-body">
      <template v-for="segment in segments" :key="segment.key">
        <AgentMessage v-if="segment.type === 'text'" :text="segment.text" />
        <AgentActivity v-else :tools="segment.tools" />
      </template>
      <div v-if="busy && last && waiting" class="thinking" role="status">
        <span class="thinking-dots" aria-hidden="true"><i /><i /><i /></span
        >{{ turn.tools.some((t) => t.status === "running") ? "Выполняет задачу" : "Думает" }}
      </div>
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
