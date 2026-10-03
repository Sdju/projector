<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import { monaco, language, editorTheme, loadEditorTheme } from "../lib/monaco.ts";
import { gutterRequest } from "../api.ts";
import { attachDirtyDiff, type DirtyDiff } from "../lib/dirty-diff.ts";
const props = defineProps<{
  path: string;
  content: string;
  original?: string;
  line?: number;
  column?: number;
  editable?: boolean;
  projectId?: string;
  revision?: number;
}>();
const emit = defineEmits<{ change: [content: string]; save: [] }>();
const container = ref<HTMLElement>();
let editor: monaco.editor.IStandaloneCodeEditor | monaco.editor.IStandaloneDiffEditor | undefined;
let models: monaco.editor.ITextModel[] = [];
let views = new Map<string, monaco.editor.ICodeEditorViewState | null>();
let activePath = "";
let dirtyDiff: DirtyDiff | undefined;
let gutterToken = 0;
function clearGutter() {
  dirtyDiff?.dispose();
  dirtyDiff = undefined;
}
async function loadGutter() {
  const token = ++gutterToken;
  const target = editor && !("getOriginalEditor" in editor) ? editor : undefined;
  if (!target || props.original !== undefined || !props.projectId || props.path.startsWith("/")) {
    clearGutter();
    return;
  }
  try {
    const data = await gutterRequest(props.projectId, props.path);
    if (token !== gutterToken || editor !== target) return;
    dirtyDiff ??= attachDirtyDiff(target);
    dirtyDiff.setOriginal(data.available ? data.original : null);
  } catch {
    if (token === gutterToken) clearGutter();
  }
}
function render() {
  if (!container.value) return;
  if (editor && !("getOriginalEditor" in editor)) views.set(activePath, editor.saveViewState());
  clearGutter();
  editor?.dispose();
  models.forEach((model) => model.dispose());
  models = [];
  activePath = props.path;
  const options: monaco.editor.IStandaloneEditorConstructionOptions = {
    theme: editorTheme.value,
    readOnly: !props.editable,
    domReadOnly: !props.editable,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    fontFamily: '"Noto Sans Mono", monospace',
    scrollBeyondLastLine: false,
    padding: { top: 16 },
    renderLineHighlight: "line",
    wordWrap: props.editable ? "on" : "off",
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
    if (props.editable) {
      editor.onDidChangeModelContent(() => emit("change", modified.getValue()));
    }
  }
  void loadGutter();
  reveal();
}
function focusOut(event: FocusEvent) {
  if (!props.editable) return;
  const target = event.relatedTarget;
  if (target instanceof Node && container.value?.contains(target)) return;
  emit("save");
}
function reveal() {
  if (!editor || !props.line) return;
  const target = "getModifiedEditor" in editor ? editor.getModifiedEditor() : editor;
  target.revealLineInCenter(props.line);
  target.setPosition({ lineNumber: props.line, column: props.column ?? 1 });
}
onMounted(() => {
  render();
  void loadEditorTheme().catch(() => undefined);
});
watch(() => [props.path, props.original, props.editable], render);
watch(
  () => props.content,
  (content) => {
    if (models[0] && models[0].getValue() !== content) models[0].setValue(content);
  },
);
watch(() => props.projectId, () => void loadGutter());
watch(() => props.revision, () => void loadGutter());
watch(() => [props.line, props.column], reveal);
onBeforeUnmount(() => {
  ++gutterToken;
  clearGutter();
  editor?.dispose();
  models.forEach((model) => model.dispose());
  views.clear();
});
</script>
<template>
  <div
    ref="container"
    class="code-viewer"
    @focusout="focusOut"
    :aria-label="editable ? 'Редактор файла' : 'Просмотр кода'"
  />
</template>
<style scoped>
.code-viewer {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.code-viewer :deep(.git-gutter-added),
.code-viewer :deep(.git-gutter-modified),
.code-viewer :deep(.git-gutter-deleted) {
  position: relative;
  cursor: pointer;
}
.code-viewer :deep(.git-gutter-added)::before,
.code-viewer :deep(.git-gutter-modified)::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 3px;
  background: var(--run);
}
.code-viewer :deep(.git-gutter-modified)::before {
  background: var(--info);
}
.code-viewer :deep(.git-gutter-added:hover)::before,
.code-viewer :deep(.git-gutter-modified:hover)::before {
  width: 6px;
}
.code-viewer :deep(.git-gutter-deleted)::after {
  content: "";
  position: absolute;
  left: 3px;
  bottom: 0;
  width: 0;
  height: 0;
  border-left: 4px solid var(--err);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
}
.code-viewer :deep(.git-gutter-deleted-top)::after {
  top: 0;
  bottom: auto;
}
.code-viewer :deep(.git-gutter-deleted:hover)::after {
  border-left-width: 7px;
}
.code-viewer :deep(.dirty-diff-peek) {
  box-sizing: border-box;
  height: 100%;
  overflow: hidden;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background: var(--bg-2);
}
.code-viewer :deep(.dirty-diff-bar) {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  box-sizing: border-box;
  color: var(--muted);
  font: var(--fs-xs) var(--sans);
}
.code-viewer :deep(.dirty-diff-title) {
  flex: 1;
}
.code-viewer :deep(.dirty-diff-button) {
  min-width: 20px;
  height: 18px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1;
  cursor: pointer;
}
.code-viewer :deep(.dirty-diff-button:hover) {
  background: var(--active);
  color: var(--text);
}
.code-viewer :deep(.dirty-diff-body) {
  padding-left: 64px;
  background: color-mix(in srgb, var(--err) 8%, transparent);
  font: var(--fs-sm) var(--mono);
  white-space: pre;
}
.code-viewer :deep(.dirty-diff-peek-added .dirty-diff-body) {
  display: none;
}
</style>
