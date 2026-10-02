<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import { monaco, language } from "../lib/monaco.ts";
const props = defineProps<{
  path: string;
  content: string;
  original?: string;
  line?: number;
  column?: number;
}>();
const container = ref<HTMLElement>();
let editor: monaco.editor.IStandaloneCodeEditor | monaco.editor.IStandaloneDiffEditor | undefined;
let models: monaco.editor.ITextModel[] = [];
let views = new Map<string, monaco.editor.ICodeEditorViewState | null>();
let activePath = "";
function render() {
  if (!container.value) return;
  if (editor && !("getOriginalEditor" in editor)) views.set(activePath, editor.saveViewState());
  editor?.dispose();
  models.forEach((model) => model.dispose());
  models = [];
  activePath = props.path;
  const options: monaco.editor.IStandaloneEditorConstructionOptions = {
    theme: "projector",
    readOnly: true,
    domReadOnly: true,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    fontFamily: '"Noto Sans Mono", monospace',
    scrollBeyondLastLine: false,
    padding: { top: 16 },
    renderLineHighlight: "line",
    wordWrap: "off",
    stickyScroll: { enabled: false },
  };
  const modified = monaco.editor.createModel(props.content, language(props.path));
  models.push(modified);
  if (props.original !== undefined) {
    const original = monaco.editor.createModel(props.original, language(props.path));
    models.push(original);
    editor = monaco.editor.createDiffEditor(container.value, {
      ...options,
      renderSideBySide: false,
      originalEditable: false,
      renderOverviewRuler: false,
    });
    editor.setModel({ original, modified });
  } else {
    editor = monaco.editor.create(container.value, { ...options, model: modified });
    editor.restoreViewState(views.get(props.path) ?? null);
  }
  reveal();
}
function reveal() {
  if (!editor || !props.line) return;
  const target = "getModifiedEditor" in editor ? editor.getModifiedEditor() : editor;
  target.revealLineInCenter(props.line);
  target.setPosition({ lineNumber: props.line, column: props.column ?? 1 });
}
onMounted(render);
watch(() => [props.path, props.content, props.original], render);
watch(() => [props.line, props.column], reveal);
onBeforeUnmount(() => {
  editor?.dispose();
  models.forEach((model) => model.dispose());
  views.clear();
});
</script>
<template><div ref="container" class="code-viewer" aria-label="Просмотр кода" /></template>
<style scoped>
.code-viewer {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
</style>
