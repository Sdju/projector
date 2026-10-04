<script setup lang="ts">
import IconRows from "~icons/lucide/rows-2";
import IconColumns from "~icons/lucide/columns-2";
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  drawSelection,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { editorTheme, loadEditorTheme } from "../lib/editor-theme.ts";
import { gutterRequest, workspaceCapabilities } from "../../../../workspace-api/index.ts";
import {
  dirtyDiff,
  languageCompartment,
  languageExtension,
  setOriginal,
  themeCompartment,
  themeExtension,
} from "../lib/codemirror.ts";
import {
  acquireEditorStatus,
  activateEditorStatus,
  releaseEditorStatus,
  updateEditorStatus,
  type LineEnding,
} from "../lib/editor-status.ts";
const props = defineProps<{
  path: string;
  content: string;
  original?: string;
  originalLabel?: string;
  modifiedLabel?: string;
  line?: number;
  column?: number;
  editable?: boolean;
  projectId?: string;
  revision?: number;
}>();
const emit = defineEmits<{ change: [content: string]; save: [] }>();
const container = ref<HTMLElement>();
let view: EditorView | undefined;
let merge: MergeView | undefined;
const sideBySide = ref(false);
let gutterToken = 0;
const states = new Map<string, EditorState>();
let activePath = "";
const statusId = acquireEditorStatus();

function detectLineEnding(content: string): LineEnding {
  const index = content.indexOf("\n");
  return index > 0 && content[index - 1] === "\r" ? "CRLF" : "LF";
}
function reportCursor(state: EditorState) {
  const { main } = state.selection;
  const line = state.doc.lineAt(main.head);
  return {
    line: line.number,
    column: main.head - line.from + 1,
    selectedChars: main.empty ? 0 : main.to - main.from,
    selectedLines: main.empty ? 0 : state.doc.lineAt(main.to).number - line.number + 1,
    lineEnding: detectLineEnding(props.content),
  };
}

async function loadGutter() {
  const token = ++gutterToken;
  const target = view;
  if (
    !target ||
    props.original !== undefined ||
    !props.projectId ||
    props.path.startsWith("/") ||
    !workspaceCapabilities(props.projectId).git
  ) {
    target?.dispatch({ effects: setOriginal.of(null) });
    return;
  }
  try {
    const data = await gutterRequest(props.projectId, props.path);
    if (token !== gutterToken || view !== target) return;
    target.dispatch({ effects: setOriginal.of(data.available ? data.original : null) });
  } catch {
    if (token === gutterToken) target.dispatch({ effects: setOriginal.of(null) });
  }
}
/** Only "reject" is offered: accepting would redefine the Git-index side. */
function revertButton(type: "reject" | "accept", action: (event: MouseEvent) => void) {
  const element = document.createElement(type === "reject" ? "button" : "span");
  if (type === "reject") {
    element.className = "diff-revert";
    element.textContent = "↶ Откатить";
    element.title = "Вернуть версию из индекса";
    element.onmousedown = action;
  }
  return element;
}
function extensions(mode: "inline" | "side" = "inline") {
  return [
    lineNumbers(),
    foldGutter(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSelectionMatches(),
    history(),
    keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
    EditorState.readOnly.of(!props.editable),
    EditorView.editable.of(!!props.editable),
    props.editable ? EditorView.lineWrapping : [],
    themeCompartment.of(themeExtension(editorTheme.value)),
    languageCompartment.of([]),
    EditorState.phrases.of({
      "Revert this chunk": "Откатить изменение",
      "$ unchanged lines": "$ строк без изменений",
    }),
    props.original === undefined
      ? dirtyDiff
      : mode === "inline"
        ? unifiedMergeView({
            original: props.original,
            gutter: true,
            mergeControls: props.editable ? revertButton : false,
          })
        : [],
    EditorView.updateListener.of((update) => {
      if (update.docChanged && props.editable) emit("change", update.state.doc.toString());
      if (update.view !== view) return;
      if (update.selectionSet) activateEditorStatus(statusId, reportCursor(update.state));
      else if (update.docChanged) updateEditorStatus(statusId, reportCursor(update.state));
    }),
  ];
}
function render() {
  if (!container.value) return;
  if (view) states.set(activePath, view.state);
  merge?.destroy();
  merge = undefined;
  view?.destroy();
  activePath = props.path;
  const saved = props.original === undefined ? states.get(props.path) : undefined;
  if (props.original !== undefined && sideBySide.value) {
    merge = new MergeView({
      parent: container.value,
      a: {
        doc: props.original,
        extensions: [
          ...extensions("side"),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ],
      },
      b: { doc: props.content, extensions: extensions("side") },
      gutter: true,
      revertControls: props.editable ? "a-to-b" : undefined,
      highlightChanges: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    });
    view = merge.b;
  } else {
    view = new EditorView({
      parent: container.value,
      state: saved ?? EditorState.create({ doc: props.content, extensions: extensions() }),
    });
  }
  const target = view;
  activateEditorStatus(statusId, reportCursor(target.state));
  void languageExtension(props.path).then((ext) => {
    if (view !== target) return;
    const effects = { effects: languageCompartment.reconfigure(ext) };
    merge?.a.dispatch(effects);
    target.dispatch(effects);
  });
  void loadGutter();
  reveal();
}
function reveal() {
  if (!view || !props.line) return;
  const line = view.state.doc.line(Math.min(props.line, view.state.doc.lines));
  const pos = Math.min(line.from + (props.column ?? 1) - 1, line.to);
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "center" }),
  });
}
function focusOut(event: FocusEvent) {
  if (!props.editable) return;
  const target = event.relatedTarget;
  if (target instanceof Node && container.value?.contains(target)) return;
  emit("save");
}
onMounted(() => {
  render();
  void loadEditorTheme().catch(() => undefined);
});
watch(() => [props.path, props.original, props.editable, sideBySide.value], render);
watch(editorTheme, (theme) => {
  const effects = { effects: themeCompartment.reconfigure(themeExtension(theme)) };
  merge?.a.dispatch(effects);
  view?.dispatch(effects);
});
watch(
  () => props.content,
  (content) => {
    if (view && view.state.doc.toString() !== content)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  },
);
watch(
  () => [props.projectId, props.revision],
  () => void loadGutter(),
);
watch(() => [props.line, props.column], reveal);
onBeforeUnmount(() => {
  ++gutterToken;
  merge?.destroy();
  view?.destroy();
  states.clear();
  releaseEditorStatus(statusId);
});
</script>
<template>
  <div class="code-viewer-root">
    <div v-if="original !== undefined" class="diff-layout" role="group" aria-label="Вид сравнения">
      <button
        type="button"
        title="В одну колонку"
        :aria-pressed="!sideBySide"
        :class="{ active: !sideBySide }"
        @click="sideBySide = false"
      >
        <IconRows />
      </button>
      <button
        type="button"
        title="Две колонки"
        :aria-pressed="sideBySide"
        :class="{ active: sideBySide }"
        @click="sideBySide = true"
      >
        <IconColumns />
      </button>
    </div>
    <div v-if="original !== undefined" class="diff-header">
      <span class="diff-side">{{ originalLabel ?? "Было" }}</span>
      <span class="diff-arrow" v-if="!sideBySide">→</span>
      <span class="diff-side">{{ modifiedLabel ?? "Стало" }}</span>
    </div>
    <div
      ref="container"
      class="code-viewer"
      @focusout="focusOut"
      :aria-label="editable ? 'Редактор файла' : 'Просмотр кода'"
    />
  </div>
</template>
<style scoped>
.code-viewer-root {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.diff-header {
  display: flex;
  flex: none;
  align-items: center;
  height: 24px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font: var(--fs-xs) var(--sans);
}
.diff-side {
  flex: 1;
  min-width: 0;
  padding: 0 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diff-side + .diff-side {
  border-left: 1px solid var(--line);
}
.diff-arrow {
  flex: none;
}
.diff-layout {
  position: absolute;
  top: 2px;
  right: 18px;
  z-index: 5;
  display: flex;
  gap: 2px;
}
.diff-layout button {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.diff-layout button:hover,
.diff-layout button.active {
  background: var(--active);
  color: var(--text);
}
.code-viewer :deep(.cm-mergeView),
.code-viewer :deep(.cm-mergeViewEditors) {
  height: 100%;
}
.code-viewer :deep(.cm-mergeViewEditor) {
  height: 100%;
  min-width: 0;
  overflow: hidden;
}
.code-viewer :deep(.cm-mergeViewEditor + .cm-mergeViewEditor) {
  border-left: 1px solid var(--line);
}
.code-viewer :deep(.cm-mergeView .cm-editor) {
  height: 100%;
}
.code-viewer {
  flex: 1;
  height: auto;
  min-height: 0;
  overflow: hidden;
}
.code-viewer :deep(.cm-dirty-gutter) {
  width: 10px;
}
.code-viewer :deep(.git-gutter-added),
.code-viewer :deep(.git-gutter-modified) {
  height: 100%;
  margin-left: 3px;
  width: 3px;
  cursor: pointer;
  background: var(--run);
}
.code-viewer :deep(.git-gutter-modified) {
  background: var(--info);
}
.code-viewer :deep(.git-gutter-deleted) {
  margin-left: 3px;
  width: 0;
  height: 0;
  margin-top: 100%;
  border-left: 4px solid var(--err);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
}
.code-viewer :deep(.git-gutter-deleted-top) {
  margin-top: 0;
}
.code-viewer :deep(.dirty-diff-peek) {
  box-sizing: border-box;
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
  height: 20px;
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
  padding: 0 0 0 64px;
  background: color-mix(in srgb, var(--err) 8%, transparent);
  font: var(--fs-sm) var(--mono);
  white-space: pre;
  line-height: 20px;
}
.code-viewer :deep(.cm-changedLine) {
  background: color-mix(in srgb, var(--run) 8%, transparent);
}
.code-viewer :deep(.cm-changedText) {
  background: color-mix(in srgb, var(--run) 20%, transparent);
}
.code-viewer :deep(.diff-revert) {
  margin: 0 4px;
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-2);
  color: var(--muted);
  font: var(--fs-xs) var(--sans);
  cursor: pointer;
}
.code-viewer :deep(.diff-revert:hover) {
  background: var(--active);
  color: var(--text);
}
.code-viewer :deep(.cm-deletedChunk) {
  background: color-mix(in srgb, var(--err) 8%, transparent);
}
</style>
