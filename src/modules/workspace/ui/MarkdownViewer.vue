<script setup lang="ts">
import { defineAsyncComponent, ref } from "vue";
import VisualMarkdownEditor from "./VisualMarkdownEditor.vue";
const CodeViewer = defineAsyncComponent(() => import("./CodeViewer.vue"));
defineProps<{
  projectId: string;
  path: string;
  content: string;
  mode: "document" | "source";
  error?: string;
  line?: number;
  column?: number;
}>();
const emit = defineEmits<{
  change: [content: string];
  mode: [mode: "document" | "source"];
  save: [];
  open: [path: string];
}>();
const editorError = ref("");
function focusOut(event: FocusEvent) {
  const editor = event.currentTarget as HTMLElement;
  const target = event.relatedTarget;
  // Floating formatting controls belong to the document too.
  if (target instanceof Node && editor.contains(target)) return;
  emit("save");
}
</script>

<template>
  <section
    class="markdown-viewer"
    aria-label="Документ Markdown"
    @focusout="focusOut"
    @keydown.ctrl.s.prevent="emit('save')"
    @keydown.meta.s.prevent="emit('save')"
  >
    <p v-if="error" class="save-error" role="alert">{{ error }}</p>
    <p v-if="editorError && mode === 'document'" class="save-error" role="alert">
      {{ editorError }} <button @click="emit('mode', 'source')">Открыть исходник</button>
    </p>
    <div class="markdown-body">
      <VisualMarkdownEditor
        v-show="mode === 'document'"
        :path="path"
        :project-id="projectId"
        :content="content"
        @change="emit('change', $event)"
        @open="emit('open', $event)"
        @error="editorError = $event"
      />
      <CodeViewer
        v-if="mode === 'source'"
        :path="path"
        :content="content"
        :line="line"
        :column="column"
        editable
        @change="emit('change', $event)"
        @save="emit('save')"
      />
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
.save-error {
  color: var(--err);
  font-size: 12px;
  margin: 0;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
}
.save-error button {
  text-decoration: underline;
}
.markdown-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
