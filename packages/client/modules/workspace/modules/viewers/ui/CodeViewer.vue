<script setup lang="ts">
import ProjectorIcon from "../../../../../common/icons/ProjectorIcon.vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiPanel from "../../../../../common/ui/UiPanel.vue";
import { computed, inject, onMounted, onBeforeUnmount, ref, watch } from "vue";
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  drawSelection,
} from "@codemirror/view";
import { EditorState, type StateEffect } from "@codemirror/state";
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
  reviewEditorExtension,
  setReviewState,
  type InlineReviewState,
} from "../lib/review-editor.ts";
import { selectionActionsTooltip, selectionLines } from "../lib/selection-tooltip.ts";
import { useEditorStatusStore } from "../lib/editor-status.ts";
import { languageRevision } from "../../../../plugin-runtime/index.ts";
import {
  appearanceFonts,
  appearanceScheme,
  loadAppearanceFonts,
} from "../../../../appearance/index.ts";
import EditorTopbarActions from "./EditorTopbarActions.vue";

const props = defineProps<{
  path: string;
  content: string;
  original?: string;
  originalLabel?: string;
  modifiedLabel?: string;
  line?: number;
  /** With `line`, selects the whole range when the file opens. */
  endLine?: number;
  column?: number;
  editable?: boolean;
  projectId?: string;
  revision?: number;
  /** Git index side of a local diff; remarks of a review open this side. */
  staged?: boolean;
}>();
const emit = defineEmits<{ change: [content: string]; save: []; ready: [] }>();
const container = ref<HTMLElement>();
let view: EditorView | undefined;
let merge: MergeView | undefined;
const sideBySide = ref(false);
const collapseUnchanged = ref(true);
let gutterToken = 0;
let languageToken = 0;
const states = new Map<string, EditorState>();
let activePath = "";
const statusStore = useEditorStatusStore();
const statusId = statusStore.acquire();
/** The workspace's selection store; the key is global so this view does not import the command layer. */
interface EditorSelectionSink {
  report(range: { path: string; from: number; to: number }): void;
  clear(path: string): void;
  /** Adds the current range to the agent chat. */
  add(): void;
}
const editorSelection = inject<EditorSelectionSink | undefined>(
  Symbol.for("projector.editor-selection"),
  undefined,
);
interface ReviewSinkComment {
  id: string;
  path: string;
  from: number;
  to: number;
  staged?: boolean;
  text: string;
}
interface ReviewSink {
  comments: { value: readonly ReviewSinkComment[] };
  composing: { value?: { path: string; from: number; to: number; staged?: boolean } };
  editing: { value?: string };
  commentsFor: (path: string, staged?: boolean) => readonly ReviewSinkComment[];
  begin: (range: {
    path: string;
    from: number;
    to: number;
    staged?: boolean;
    snippet?: string;
  }) => void;
  finish: (text: string) => void;
  update: (id: string, text: string) => void;
  remove: (id: string) => void;
  edit: (id?: string) => void;
  cancel: () => void;
  open: () => void;
}
const review = inject<ReviewSink | undefined>(Symbol.for("projector.review"), undefined);

/** A live project file: diffs and snapshots without a project id stay out of chat and review. */
const liveFile = () => !!props.projectId && !props.path.startsWith("/");
const matchesSide = (staged?: boolean) =>
  props.staged === true ? staged === true : staged !== true;

/** Only a live project file with a tab reports: diffs, previews and external paths are not chat context. */
const tracksSelection = () =>
  !!editorSelection && liveFile() && props.editable === true && props.original === undefined;
/** Diffs always allow commenting; plain files offer it once a review has remarks. */
const tracksReview = () =>
  liveFile() && !!review && (props.original !== undefined || review.comments.value.length > 0);

const fileReviewCount = computed(() =>
  liveFile() && review ? review.commentsFor(props.path, props.staged).length : 0,
);
const totalReviewCount = computed(() => (liveFile() && review ? review.comments.value.length : 0));
const showReviewIndicator = computed(
  () => fileReviewCount.value > 0 || (props.original !== undefined && totalReviewCount.value > 0),
);

function reportSelection(state: EditorState) {
  if (!tracksSelection()) return;
  const { from, to } = selectionLines(state);
  editorSelection!.report({ path: props.path, from, to });
}

function selectionTooltipExtension() {
  return selectionActionsTooltip({
    canChat: tracksSelection,
    canReview: tracksReview,
    onChat: () => editorSelection?.add(),
    onReview: (range) => review?.begin({ path: props.path, staged: props.staged, ...range }),
  });
}

function currentReviewState(): InlineReviewState {
  if (!liveFile() || !review) return { comments: [] };
  const comments = review.commentsFor(props.path, props.staged).map((item) => ({
    id: item.id,
    from: item.from,
    to: item.to,
    text: item.text,
  }));
  const composing = review.composing.value;
  const activeComposing =
    composing && composing.path === props.path && matchesSide(composing.staged)
      ? { from: composing.from, to: composing.to }
      : undefined;
  const editing =
    review.editing.value && comments.some((item) => item.id === review.editing.value)
      ? review.editing.value
      : undefined;
  return { comments, composing: activeComposing, editing };
}

function syncReview(scrollToComposer = false) {
  if (!view || !liveFile() || !review) return;
  const next = currentReviewState();
  const effects: StateEffect<unknown>[] = [setReviewState.of(next)];
  if (scrollToComposer && next.composing) {
    const lineNo = Math.max(1, Math.min(next.composing.to, view.state.doc.lines));
    effects.push(
      EditorView.scrollIntoView(view.state.doc.line(lineNo).to, { y: "nearest", yMargin: 160 }),
    );
  }
  view.dispatch({ effects });
}

function reviewExtensionFor(pane: "original" | "modified") {
  if (!liveFile() || !review || pane === "original") return [];
  return reviewEditorExtension(
    {
      onStart: (from, to, snippet) =>
        review.begin({ path: props.path, from, to, staged: props.staged, snippet }),
      onSubmit: (text) => review.finish(text),
      onUpdate: (id, text) => review.update(id, text),
      onRemove: (id) => review.remove(id),
      onEdit: (id) => review.edit(id),
      onCancel: () => review.cancel(),
    },
    { showGutter: props.original !== undefined },
  );
}

function reportCursor(state: EditorState) {
  const { main } = state.selection;
  const line = state.doc.lineAt(main.head);
  return {
    line: line.number,
    column: main.head - line.from + 1,
    selectedChars: main.empty ? 0 : main.to - main.from,
    selectedLines: main.empty ? 0 : state.doc.lineAt(main.to).number - line.number + 1,
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
function extensions(
  mode: "inline" | "side" = "inline",
  pane: "original" | "modified" = "modified",
) {
  const isModified = pane === "modified";
  return [
    lineNumbers(),
    ...(isModified ? [reviewExtensionFor(pane)] : []),
    foldGutter(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSelectionMatches(),
    history(),
    keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
    EditorState.readOnly.of(!props.editable || !isModified),
    EditorView.editable.of(!!props.editable && isModified),
    props.editable ? EditorView.lineWrapping : [],
    ...(liveFile() && isModified ? [selectionTooltipExtension()] : []),
    themeCompartment.of(themeExtension(editorTheme.value, appearanceFonts.value.editor)),
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
            collapseUnchanged: collapseUnchanged.value ? { margin: 3, minSize: 6 } : undefined,
          })
        : [],
    EditorView.updateListener.of((update) => {
      if (update.docChanged && props.editable && isModified)
        emit("change", update.state.doc.toString());
      if (update.view !== view) return;
      if (update.selectionSet) statusStore.activate(statusId, reportCursor(update.state));
      else if (update.docChanged) statusStore.update(statusId, reportCursor(update.state));
      if ((update.selectionSet || update.docChanged) && update.view.hasFocus)
        reportSelection(update.state);
    }),
    EditorView.domEventHandlers({
      focus(_event, target) {
        reportSelection(target.state);
        return false;
      },
    }),
  ];
}
function applyLanguage(target: EditorView) {
  const token = ++languageToken;
  const mergeA = merge?.a;
  void languageExtension(props.path).then((ext) => {
    if (token !== languageToken || view !== target) return;
    const effects = { effects: languageCompartment.reconfigure(ext) };
    // A stale async load (a plugin was disabled or the file changed) never wins the race.
    mergeA?.dispatch(effects);
    target.dispatch(effects);
  });
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
        extensions: extensions("side", "original"),
      },
      b: { doc: props.content, extensions: extensions("side", "modified") },
      gutter: true,
      revertControls: props.editable ? "a-to-b" : undefined,
      highlightChanges: true,
      collapseUnchanged: collapseUnchanged.value ? { margin: 3, minSize: 6 } : undefined,
    });
    view = merge.b;
  } else {
    view = new EditorView({
      parent: container.value,
      state: saved ?? EditorState.create({ doc: props.content, extensions: extensions() }),
    });
  }
  const target = view;
  statusStore.activate(statusId, reportCursor(target.state));
  applyLanguage(target);
  void loadGutter();
  syncReview(true);
  reveal();
}
function reveal() {
  if (!view || !props.line) return;
  const line = view.state.doc.line(Math.min(props.line, view.state.doc.lines));
  if (props.endLine) {
    const end = view.state.doc.line(
      Math.max(line.number, Math.min(props.endLine, view.state.doc.lines)),
    );
    view.dispatch({
      selection: { anchor: line.from, head: end.to },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    return;
  }
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
  emit("ready");
  void loadEditorTheme().catch(() => undefined);
  void loadAppearanceFonts().catch(() => undefined);
});
watch(
  () => [props.path, props.original, props.editable, sideBySide.value, collapseUnchanged.value],
  render,
);
watch(
  [editorTheme, appearanceScheme, () => appearanceFonts.value.editor],
  ([theme, , fontSize]) => {
    const effects = { effects: themeCompartment.reconfigure(themeExtension(theme, fontSize)) };
    merge?.a.dispatch(effects);
    view?.dispatch(effects);
  },
);
watch(languageRevision, () => {
  if (view) applyLanguage(view);
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
watch(() => [props.line, props.column, props.endLine], reveal);
watch(
  () => [
    review?.comments.value,
    review?.composing.value,
    review?.editing.value,
    props.path,
    props.staged,
  ],
  ([, composing], [, prevComposing]) => {
    syncReview(!!composing && composing !== prevComposing);
  },
  { deep: true },
);
onBeforeUnmount(() => {
  ++gutterToken;
  merge?.destroy();
  view?.destroy();
  states.clear();
  statusStore.release(statusId);
  editorSelection?.clear(props.path);
});
</script>
<template>
  <UiPanel as="div" class="code-viewer-root">
    <EditorTopbarActions v-if="showReviewIndicator">
      <UiButton
        size="sm"
        appearance="quiet"
        class="review-topbar-btn"
        :class="{ active: fileReviewCount > 0 }"
        :title="
          fileReviewCount > 0
            ? `Замечаний в файле: ${fileReviewCount} (всего в ревью: ${totalReviewCount}). Открыть ревью`
            : `Замечаний в ревью: ${totalReviewCount}. Открыть ревью`
        "
        data-command="ide.review.open"
        @click="review?.open()"
      >
        <ProjectorIcon name="message-square" class="review-topbar-icon" aria-hidden="true" />
        <span>{{ fileReviewCount > 0 ? fileReviewCount : totalReviewCount }}</span>
      </UiButton>
    </EditorTopbarActions>
    <div v-if="original !== undefined" class="diff-layout" role="group" aria-label="Вид сравнения">
      <button
        type="button"
        :title="sideBySide ? 'В одну колонку' : 'Две колонки'"
        :aria-label="sideBySide ? 'В одну колонку' : 'Две колонки'"
        :aria-pressed="sideBySide"
        @click="sideBySide = !sideBySide"
      >
        <ProjectorIcon name="rows-2" v-if="sideBySide" />
        <ProjectorIcon name="columns-2" v-else />
      </button>
      <button
        type="button"
        :title="
          collapseUnchanged ? 'Развернуть неизменённые строки' : 'Свернуть неизменённые строки'
        "
        :aria-label="
          collapseUnchanged ? 'Развернуть неизменённые строки' : 'Свернуть неизменённые строки'
        "
        :aria-pressed="collapseUnchanged"
        @click="collapseUnchanged = !collapseUnchanged"
      >
        <ProjectorIcon name="unfold-vertical" v-if="collapseUnchanged" />
        <ProjectorIcon name="fold-vertical" v-else />
      </button>
    </div>
    <div v-if="original !== undefined" class="diff-header">
      <span class="diff-side u-truncate">{{ originalLabel ?? "Было" }}</span>
      <span class="diff-arrow" v-if="!sideBySide">→</span>
      <span class="diff-side u-truncate">{{ modifiedLabel ?? "Стало" }}</span>
    </div>
    <div
      ref="container"
      class="code-viewer"
      @focusout="focusOut"
      :aria-label="editable ? 'Редактор файла' : 'Просмотр кода'"
    />
  </UiPanel>
</template>
<style scoped>
.code-viewer-root {
  position: relative;
}
.review-topbar-btn {
  min-height: 22px;
  padding: 0 7px;
  gap: 4px;
  font: var(--fs-2xs) var(--mono);
  color: var(--muted);
}
.review-topbar-btn.active {
  color: var(--accent);
}
.review-topbar-icon {
  width: 12px;
  height: 12px;
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
[data-theme-effects] .code-viewer :deep(.cm-editor),
[data-theme-effects] .code-viewer :deep(.cm-gutters) {
  background-color: var(--theme-panel-background);
}
.code-viewer :deep(.selection-actions) {
  display: flex;
  gap: 4px;
}
.code-viewer :deep(.selection-chat) {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-full);
  background: var(--bg-3);
  box-shadow: var(--shadow-popover);
  color: var(--text);
  font: var(--fs-xs) var(--sans);
  cursor: pointer;
}
.code-viewer :deep(.selection-chat:hover) {
  background: var(--bg-4);
}
.code-viewer :deep(.selection-chat:focus-visible) {
  border-color: var(--focus);
  background: var(--bg-4);
}
.code-viewer :deep(.selection-review) {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--line-strong));
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
