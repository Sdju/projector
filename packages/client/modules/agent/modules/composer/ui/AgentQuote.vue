<script setup lang="ts">
import { useChatQuote } from "../lib/chat-quote.ts";

const props = defineProps<{ root?: HTMLElement }>();
const emit = defineEmits<{ quote: [text: string] }>();
const { text, position, add } = useChatQuote({
  root: () => props.root,
  quote: (value) => emit("quote", value),
});
</script>

<template>
  <Teleport to="body">
    <button
      v-if="text && position"
      type="button"
      class="quote-selection"
      title="Цитировать выделенный текст"
      aria-label="Цитировать выделенный текст"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
      @mousedown.prevent
      @click="add"
    >
      Цитировать
    </button>
  </Teleport>
</template>

<style scoped>
.quote-selection {
  position: fixed;
  z-index: 40;
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-full);
  background: var(--bg-3);
  box-shadow: var(--shadow-popover);
  color: var(--text);
  font: var(--fs-xs) var(--sans);
  cursor: pointer;
}
.quote-selection:hover {
  background: var(--bg-4);
}
.quote-selection:focus-visible {
  border-color: var(--focus);
  background: var(--bg-4);
}
</style>
