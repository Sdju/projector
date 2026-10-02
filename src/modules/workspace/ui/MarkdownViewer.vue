<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { renderMarkdown } from "../lib/markdown.ts";
import "highlight.js/styles/github-dark-dimmed.css";
const CodeViewer = defineAsyncComponent(() => import("./CodeViewer.vue"));
const props = defineProps<{
  projectId: string;
  path: string;
  content: string;
  mode: "preview" | "edit" | "split";
  dirty: boolean;
  saving: boolean;
  error?: string;
  line?: number;
  column?: number;
}>();
const emit = defineEmits<{
  change: [content: string];
  mode: [mode: "preview" | "edit" | "split"];
  save: [];
  open: [path: string];
}>();
const html = computed(() => renderMarkdown(props.content, props.path, props.projectId));
function followLink(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest("a");
  if (!link) return;
  const path = link.dataset.workspacePath;
  if (path) {
    event.preventDefault();
    emit("open", path);
  } else if (link.getAttribute("href")?.startsWith("#")) {
    event.preventDefault();
    const hash = decodeURIComponent(link.getAttribute("href")!.slice(1));
    const article = link.closest("article");
    const heading = Array.from(article?.querySelectorAll("[id]") ?? []).find(
      (element) => element.id === `md-${hash}` || element.id === hash,
    );
    heading?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}
</script>

<template>
  <section
    class="markdown-viewer"
    aria-label="Документ Markdown"
    @keydown.ctrl.s.prevent="emit('save')"
    @keydown.meta.s.prevent="emit('save')"
  >
    <div class="markdown-toolbar">
      <div class="modes" role="group" aria-label="Режим Markdown">
        <button :aria-pressed="mode === 'preview'" @click="emit('mode', 'preview')">Чтение</button>
        <button :aria-pressed="mode === 'edit'" @click="emit('mode', 'edit')">
          Редактирование
        </button>
        <button :aria-pressed="mode === 'split'" @click="emit('mode', 'split')">Рядом</button>
      </div>
      <span class="save-state" role="status">{{
        saving ? "Сохраняю…" : dirty ? "Не сохранено" : "Сохранено"
      }}</span>
      <button
        class="save"
        :disabled="!dirty || saving"
        title="Сохранить (Ctrl+S)"
        @click="emit('save')"
      >
        Сохранить
      </button>
    </div>
    <p v-if="error" class="save-error" role="alert">{{ error }}</p>
    <div class="markdown-panes" :class="{ split: mode === 'split' }">
      <CodeViewer
        v-if="mode !== 'preview'"
        :path="path"
        :content="content"
        :line="line"
        :column="column"
        editable
        @change="emit('change', $event)"
        @save="emit('save')"
      />
      <div v-if="mode !== 'edit'" class="preview" tabindex="0" aria-label="Чтение Markdown">
        <article class="markdown-content" @click="followLink" v-html="html" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.markdown-viewer {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.markdown-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--bg-2);
  font-size: 11px;
}
.modes {
  display: flex;
  gap: 3px;
}
.modes button,
.save {
  padding: 5px 8px;
  border-radius: 4px;
}
.modes button {
  color: var(--muted);
}
.modes button[aria-pressed="true"] {
  color: var(--text);
  background: #30302b;
}
.save-state {
  margin-left: auto;
  color: var(--muted);
}
.save {
  border: 1px solid var(--line);
}
.save:disabled {
  opacity: 0.4;
  cursor: default;
}
.save-error {
  color: var(--err);
  font-size: 12px;
  margin: 0;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
}
.markdown-panes {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
.markdown-panes.split {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.split .preview {
  border-left: 1px solid var(--line);
}
.preview {
  min-height: 0;
  min-width: 0;
  overflow: auto;
}
.markdown-content {
  max-width: 820px;
  margin: 0 auto;
  padding: clamp(20px, 3vw, 44px);
  font-size: 15px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.markdown-content :deep(> :first-child) {
  margin-top: 0;
}
.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  line-height: 1.35;
  margin: 1.8em 0 0.65em;
  font-weight: 650;
  letter-spacing: -0.02em;
  scroll-margin-top: 24px;
}
.markdown-content :deep(h1) {
  font-size: 2em;
  padding-bottom: 0.4em;
  border-bottom: 1px solid var(--line);
}
.markdown-content :deep(h2) {
  font-size: 1.5em;
  padding-bottom: 0.35em;
  border-bottom: 1px solid var(--line);
}
.markdown-content :deep(h3) {
  font-size: 1.2em;
}
.markdown-content :deep(p),
.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 0 0 1em;
}
.markdown-content :deep(li + li) {
  margin-top: 0.25em;
}
.markdown-content :deep(a) {
  color: #a4c7e8;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.markdown-content :deep(blockquote) {
  margin: 1.2em 0;
  padding: 0.4em 1.2em;
  color: #b5b5aa;
  border-left: 3px solid #66685a;
  background: var(--bg-2);
}
.markdown-content :deep(blockquote > :last-child) {
  margin-bottom: 0;
}
.markdown-content :deep(code) {
  font: 0.85em var(--mono);
  background: #24241f;
  padding: 0.2em 0.4em;
  border-radius: 4px;
}
.markdown-content :deep(pre) {
  padding: 16px;
  overflow: auto;
  background: #181a1c;
  border: 1px solid var(--line);
  border-radius: 6px;
  line-height: 1.6;
}
.markdown-content :deep(pre code) {
  padding: 0;
  background: transparent;
  white-space: pre;
  overflow-wrap: normal;
}
.markdown-content :deep(table) {
  display: block;
  max-width: 100%;
  overflow: auto;
  border-collapse: collapse;
  margin: 1.2em 0;
  font-size: 0.9em;
}
.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid var(--line);
  padding: 8px 12px;
}
.markdown-content :deep(th),
.markdown-content :deep(tr:nth-child(even)) {
  background: var(--bg-2);
}
.markdown-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}
.markdown-content :deep(hr) {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 2em 0;
}
.markdown-content :deep(.task-list-item) {
  list-style: none;
}
.markdown-content :deep(input[type="checkbox"]) {
  width: auto;
  min-height: 0;
  margin-right: 0.5em;
  accent-color: var(--run);
}
.markdown-content :deep(details) {
  border: 1px solid var(--line);
  padding: 10px 14px;
  border-radius: 4px;
  margin: 1em 0;
}
.markdown-content :deep(summary) {
  cursor: pointer;
}
@media (max-width: 700px) {
  .markdown-panes.split {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(180px, 1fr) minmax(180px, 1fr);
  }
  .split .preview {
    border-left: 0;
    border-top: 1px solid var(--line);
  }
}
</style>
