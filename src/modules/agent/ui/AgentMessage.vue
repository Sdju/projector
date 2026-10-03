<script setup lang="ts">
import { computed } from "vue";
import { renderChatMarkdown } from "../lib/markdown.ts";
const props = defineProps<{ text: string }>();
const html = computed(() => renderChatMarkdown(props.text));
</script>

<template>
  <div class="agent-message" v-html="html" />
</template>

<style scoped>
.agent-message {
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.agent-message :deep(> :first-child) {
  margin-top: 0;
}
.agent-message :deep(> :last-child) {
  margin-bottom: 0;
}
.agent-message :deep(p) {
  margin: 0 0 12px;
}
.agent-message :deep(h1),
.agent-message :deep(h2),
.agent-message :deep(h3),
.agent-message :deep(h4) {
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: 1.5;
  margin: 24px 0 10px;
  letter-spacing: -0.02em;
}
.agent-message :deep(h1) {
  font-size: var(--fs-lg);
}
.agent-message :deep(h2) {
  font-size: var(--fs-md);
}
.agent-message :deep(ul),
.agent-message :deep(ol) {
  margin: 8px 0 14px;
  padding-left: 22px;
}
.agent-message :deep(li) {
  padding-left: 3px;
  margin: 5px 0;
}
.agent-message :deep(li::marker) {
  color: var(--muted);
}
.agent-message :deep(li > p) {
  margin: 0;
}
.agent-message :deep(strong) {
  font-weight: 600;
  color: var(--text);
}
.agent-message :deep(a) {
  color: var(--text-2);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.agent-message :deep(a:hover) {
  color: var(--text);
}
.agent-message :deep(code) {
  font: var(--fs-2xs)/1.6 var(--mono);
  background: var(--bg-3);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 2px 5px;
  box-decoration-break: clone;
}
.agent-message :deep(pre) {
  margin: 14px 0;
  padding: 15px 17px;
  border-radius: var(--r-lg);
  border: 1px solid var(--line);
  background: var(--bg-sunken);
  overflow-x: auto;
  max-width: 100%;
}
.agent-message :deep(pre code) {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-2);
  font-size: var(--fs-xs);
  white-space: pre;
}
.agent-message :deep(blockquote) {
  border-left: 2px solid var(--line-strong);
  margin: 14px 0;
  padding: 2px 0 2px 16px;
  color: var(--text-2);
}
.agent-message :deep(hr) {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 22px 0;
}
.agent-message :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 14px 0;
  font-size: var(--fs-xs);
}
.agent-message :deep(th),
.agent-message :deep(td) {
  border: 1px solid var(--line);
  padding: 8px 12px;
  text-align: left;
}
.agent-message :deep(th) {
  background: var(--bg-2);
  font-weight: 500;
}
.agent-message :deep(.hljs-keyword),
.agent-message :deep(.hljs-selector-tag) {
  color: var(--warn);
}
.agent-message :deep(.hljs-string),
.agent-message :deep(.hljs-attr) {
  color: var(--run);
}
.agent-message :deep(.hljs-number),
.agent-message :deep(.hljs-literal) {
  color: var(--err);
}
.agent-message :deep(.hljs-comment) {
  color: var(--faint);
}
.agent-message :deep(.hljs-title),
.agent-message :deep(.hljs-built_in) {
  color: var(--info);
}
</style>
