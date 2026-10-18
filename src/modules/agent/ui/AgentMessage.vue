<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { renderChatMarkdown } from "../lib/markdown.ts";
import {
  AgentWidget,
  isWidgetName,
  splitMessage,
  useMessageScope,
} from "../../widget-runtime/index.ts";

const props = defineProps<{ text: string; streaming?: boolean }>();
// Text only grows, so earlier parts keep their position and source: Vue patches only the tail.
const parts = computed(() =>
  splitMessage(props.text, { known: isWidgetName, streaming: props.streaming }),
);
// The message's own `<script>`s run once into a scope its components share.
const scriptErrors = ref<string[]>([]);
useMessageScope(
  parts,
  toRef(() => !props.streaming),
  scriptErrors,
);
</script>

<template>
  <div class="agent-message">
    <template v-for="(part, index) in parts" :key="index">
      <div v-if="part.type === 'markdown'" class="md" v-html="renderChatMarkdown(part.text)" />
      <AgentWidget
        v-else-if="part.type === 'widget'"
        :source="part.source"
        :complete="part.complete"
      />
    </template>
    <p v-for="error in scriptErrors" :key="error" class="script-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.script-error {
  color: var(--err);
  font-size: var(--fs-xs);
}
.agent-message {
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.agent-message :deep(.md > :first-child) {
  margin-top: 0;
}
.agent-message :deep(.md > :last-child) {
  margin-bottom: 0;
}
.agent-message :deep(.md p) {
  margin: 0 0 12px;
}
.agent-message :deep(.md h1),
.agent-message :deep(.md h2),
.agent-message :deep(.md h3),
.agent-message :deep(.md h4) {
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: 1.5;
  margin: var(--sp-5) 0 var(--sp-2);
  letter-spacing: -0.02em;
}
.agent-message :deep(.md h1) {
  font-size: var(--fs-lg);
}
.agent-message :deep(.md h2) {
  font-size: var(--fs-md);
}
.agent-message :deep(.md ul),
.agent-message :deep(.md ol) {
  margin: 8px 0 14px;
  padding-left: 22px;
}
.agent-message :deep(.md li) {
  padding-left: 3px;
  margin: 5px 0;
}
.agent-message :deep(.md li::marker) {
  color: var(--muted);
}
.agent-message :deep(.md li > p) {
  margin: 0;
}
.agent-message :deep(.md strong) {
  font-weight: 600;
  color: var(--text);
}
.agent-message :deep(.md a) {
  color: var(--text-2);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.agent-message :deep(.md a:hover) {
  color: var(--text);
}
.agent-message :deep(.md code) {
  font: var(--fs-2xs)/1.6 var(--mono);
  background: var(--bg-3);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 2px 5px;
  box-decoration-break: clone;
}
.agent-message :deep(.md pre) {
  margin: 14px 0;
  padding: var(--sp-3);
  border-radius: var(--r-md);
  background: var(--bg-2);
  overflow-x: auto;
  max-width: 100%;
}
.agent-message :deep(.md pre code) {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-2);
  font-size: var(--fs-xs);
  white-space: pre;
}
.agent-message :deep(.md blockquote) {
  border-left: 2px solid var(--line-strong);
  margin: 14px 0;
  padding: 2px 0 2px 16px;
  color: var(--text-2);
}
.agent-message :deep(.md hr) {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 22px 0;
}
.agent-message :deep(.md table) {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 14px 0;
  font-size: var(--fs-xs);
}
.agent-message :deep(.md th),
.agent-message :deep(.md td) {
  border: 1px solid var(--line);
  padding: 8px 12px;
  text-align: left;
  vertical-align: top;
  /* Слова не рвутся: узкая колонка не становится столбиком из букв, таблица прокручивается. */
  min-width: 7em;
  max-width: 28em;
}
.agent-message :deep(.md th) {
  background: var(--bg-2);
  font-weight: 500;
}
.agent-message :deep(.md .hljs-keyword),
.agent-message :deep(.md .hljs-selector-tag) {
  color: var(--warn);
}
.agent-message :deep(.md .hljs-string),
.agent-message :deep(.md .hljs-attr) {
  color: var(--run);
}
.agent-message :deep(.md .hljs-number),
.agent-message :deep(.md .hljs-literal) {
  color: var(--err);
}
.agent-message :deep(.md .hljs-comment) {
  color: var(--faint);
}
.agent-message :deep(.md .hljs-title),
.agent-message :deep(.md .hljs-built_in) {
  color: var(--info);
}
</style>
