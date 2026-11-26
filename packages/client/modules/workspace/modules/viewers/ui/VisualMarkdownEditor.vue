<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import type { FileScope } from "@ai-projector/core/modules/workspace/index.ts";
import UiLoader from "../../../../../common/ui/UiLoader.vue";
import { MermaidModal } from "../../../../markdown/index.ts";
import MarkdownFrontmatter from "./MarkdownFrontmatter.vue";
import { useVisualMarkdownEditor } from "../lib/visual-markdown-editor.ts";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";

const props = withDefaults(
  defineProps<{
    content: string;
    path: string;
    projectId: string;
    scope?: FileScope;
    editable?: boolean;
    /** Без полей документа: рендер встроенного блока (issue, комментарий). */
    compact?: boolean;
  }>(),
  { editable: true, compact: false },
);
const emit = defineEmits<{
  change: [content: string];
  open: [path: string];
  error: [message: string];
  source: [];
  ready: [];
  command: [id: string, args?: unknown];
}>();
const root = useTemplateRef<HTMLElement>("root");
const { mermaidPreview, loading, frontmatter, applyFrontmatter, linkMouseDown, editorClick } =
  useVisualMarkdownEditor(
    props,
    computed(() => root.value ?? undefined),
    {
      onChange: (value) => emit("change", value),
      onOpen: (path) => emit("open", path),
      onError: (message) => emit("error", message),
      onSource: () => emit("source"),
      onReady: () => emit("ready"),
      onCommand: (id, args) => emit("command", id, args),
    },
  );
</script>

<template>
  <div
    class="visual-markdown"
    :class="{ compact, readonly: !editable }"
    @mousedown.capture="linkMouseDown"
    @click.capture="editorClick"
  >
    <UiLoader v-if="loading" class="editor-loading">Открываю документ…</UiLoader>
    <MarkdownFrontmatter
      v-if="frontmatter"
      :frontmatter="frontmatter"
      :editable="editable"
      @change="applyFrontmatter"
      @source="emit('source')"
    />
    <div ref="root" class="visual-markdown-root" />
  </div>
  <MermaidModal
    v-if="mermaidPreview !== undefined"
    :source="mermaidPreview"
    @close="mermaidPreview = undefined"
  />
</template>

<style scoped>
.visual-markdown {
  min-height: 0;
  min-width: 0;
  height: 100%;
  overflow: auto;
}
.editor-loading {
  color: var(--muted);
  padding: var(--sp-4) var(--sp-5);
  font-size: var(--fs-xs);
}
.visual-markdown-root {
  min-height: 100%;
}
</style>

<style scoped src="./visual-markdown-surface.css"></style>
