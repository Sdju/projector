<script setup lang="ts">
import UiPanel from "../../../../../common/ui/UiPanel.vue";
import { defineAsyncComponent, ref } from "vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import IconCode from "~icons/lucide/code-xml";
import IconDocument from "~icons/lucide/file-text";
import EditorTopbarActions from "./EditorTopbarActions.vue";
import VisualMarkdownEditor from "./VisualMarkdownEditor.vue";
const CodeViewer = defineAsyncComponent(() => import("./CodeViewer.vue"));
withDefaults(
  defineProps<{
    projectId: string;
    path: string;
    content: string;
    mode: "document" | "source";
    error?: string;
    editable?: boolean;
    line?: number;
    column?: number;
  }>(),
  { editable: true },
);
const emit = defineEmits<{
  change: [content: string];
  mode: [mode: "document" | "source"];
  save: [];
  command: [id: string];
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
  <UiPanel class="markdown-viewer" aria-label="Документ Markdown" @focusout="focusOut">
    <p v-if="error" class="save-error" role="alert">{{ error }}</p>
    <p v-if="editorError && mode === 'document'" class="save-error" role="alert">
      {{ editorError }} <button @click="emit('mode', 'source')">Открыть исходник</button>
    </p>
    <EditorTopbarActions>
      <UiButton
        shape="icon"
        size="sm"
        :aria-label="mode === 'source' ? 'Показать как документ' : 'Показать исходник'"
        :title="mode === 'source' ? 'Режим документа (WYSIWYG)' : 'Режим исходника (Markdown)'"
        @click="emit('command', 'ide.editor.markdown.toggleSource')"
      >
        <IconDocument v-if="mode === 'source'" aria-hidden="true" />
        <IconCode v-else aria-hidden="true" />
      </UiButton>
    </EditorTopbarActions>
    <div class="markdown-body">
      <VisualMarkdownEditor
        v-show="mode === 'document'"
        :path="path"
        :editable="editable !== false"
        :project-id="projectId"
        :content="content"
        @change="emit('change', $event)"
        @open="emit('open', $event)"
        @source="emit('mode', 'source')"
        @error="editorError = $event"
      />
      <CodeViewer
        v-if="mode === 'source'"
        :path="path"
        :content="content"
        :line="line"
        :column="column"
        :editable="editable !== false"
        @change="emit('change', $event)"
        @save="emit('save')"
      />
    </div>
  </UiPanel>
</template>

<style scoped>
.save-error {
  color: var(--err);
  font-size: var(--fs-xs);
  margin: 0;
  padding: 10px var(--sp-4);
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
