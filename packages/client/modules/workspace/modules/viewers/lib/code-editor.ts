import { onMounted, onBeforeUnmount, ref, watch, type Ref } from "vue";
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
import { editorTheme, loadEditorTheme } from "./editor-theme.ts";
import { gutterRequest, workspaceCapabilities } from "../../../../workspace-api/index.ts";
import {
  dirtyDiff,
  languageCompartment,
  languageExtension,
  setOriginal,
  themeCompartment,
  themeExtension,
} from "./codemirror.ts";
import { selectionActionsTooltip, selectionLines } from "./selection-tooltip.ts";
import { useEditorStatusStore } from "./editor-status.ts";
import { languageRevision } from "../../../../plugin-runtime/index.ts";
import {
  appearanceFonts,
  appearanceScheme,
  loadAppearanceFonts,
} from "../../../../appearance/index.ts";
import { useCodeReview } from "./code-review.ts";
import { injectEditorSelection } from "./editor-selection.ts";

export interface CodeEditorOptions {
  readonly path: string;
  readonly content: string;
  readonly original?: string;
  readonly line?: number;
  /** With `line`, selects the whole range when the file opens. */
  readonly endLine?: number;
  readonly column?: number;
  readonly editable?: boolean;
  readonly projectId?: string;
  readonly revision?: number;
  /** Git index side of a local diff; remarks of a review open this side. */
  readonly staged?: boolean;
}

export interface CodeEditorCallbacks {
  onChange: (content: string) => void;
  onSave: () => void;
  onReady: () => void;
}

export function useCodeEditor(
  props: CodeEditorOptions,
  container: Ref<HTMLElement | undefined>,
  callbacks: CodeEditorCallbacks,
) {
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
  const editorSelection = injectEditorSelection();
  /** A live project file: diffs and snapshots without a project id stay out of chat and review. */
  const liveFile = () => !!props.projectId && !props.path.startsWith("/");

  /** Only a live project file with a tab reports: diffs, previews and external paths are not chat context. */
  const tracksSelection = () =>
    !!editorSelection && liveFile() && props.editable === true && props.original === undefined;
  const {
    review,
    tracksReview,
    fileReviewCount,
    totalReviewCount,
    showReviewIndicator,
    syncReview,
    reviewExtensionFor,
  } = useCodeReview(props, liveFile, () => view);

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
          callbacks.onChange(update.state.doc.toString());
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
    callbacks.onSave();
  }
  onMounted(() => {
    render();
    callbacks.onReady();
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
  onBeforeUnmount(() => {
    ++gutterToken;
    ++languageToken;
    merge?.destroy();
    view?.destroy();
    states.clear();
    statusStore.release(statusId);
    editorSelection?.clear(props.path);
  });
  return {
    sideBySide,
    collapseUnchanged,
    review,
    fileReviewCount,
    totalReviewCount,
    showReviewIndicator,
    focusOut,
  };
}
