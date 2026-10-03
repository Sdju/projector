import { Decoration, EditorView, WidgetType, gutter, GutterMarker, keymap } from "@codemirror/view";
import {
  EditorState,
  Compartment,
  StateEffect,
  StateField,
  RangeSet,
  Prec,
  type Extension,
} from "@codemirror/state";
import {
  HighlightStyle,
  LanguageDescription,
  highlightingFor,
  language,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { Chunk } from "@codemirror/merge";
import { highlightTree, tags as t } from "@lezer/highlight";
import type { EditorTheme } from "../../../../../../core/modules/editor-themes/index.ts";

const palette = {
  bg: "#10100f",
  fg: "#d8d2c4",
  line: "#171716",
  border: "#2c2c28",
  selection: "#3a3934",
  gutter: "#73736b",
};
function projectorTheme(soft: boolean): Extension {
  const base = EditorView.theme(
    {
      "&": { backgroundColor: palette.bg, color: palette.fg, height: "100%" },
      ".cm-content": { caretColor: palette.fg, padding: "16px 0" },
      ".cm-cursor": { borderLeftColor: palette.fg },
      // Полупрозрачный фон: иначе активная строка перекрывает слой выделения.
      ".cm-activeLine": { backgroundColor: "#ffffff08" },
      ".cm-activeLineGutter": { backgroundColor: palette.line, color: palette.fg },
      ".cm-gutters": { backgroundColor: palette.bg, color: palette.gutter, border: "none" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
        backgroundColor: palette.selection,
      },
      ".cm-panels": { backgroundColor: palette.line, color: palette.fg },
      ".cm-searchMatch": { backgroundColor: "#61533b70" },
      ".cm-searchMatch-selected": { backgroundColor: "#61533b" },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": { fontFamily: '"Noto Sans Mono", monospace', fontSize: "13px" },
    },
    { dark: true },
  );
  if (!soft) return [base, syntaxHighlighting(classic)];
  return [base, syntaxHighlighting(softStyle)];
}
const classic = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword], color: "#c678dd" },
  { tag: [t.string, t.regexp], color: "#98c379" },
  { tag: [t.number, t.bool, t.null], color: "#d19a66" },
  { tag: t.comment, color: "#7d8799", fontStyle: "italic" },
  { tag: [t.typeName, t.className], color: "#e5c07b" },
  { tag: [t.function(t.variableName), t.propertyName], color: "#61afef" },
  { tag: [t.tagName, t.angleBracket], color: "#e06c75" },
  { tag: t.attributeName, color: "#d19a66" },
]);
// Gruvbox Material's muted accents,.
const softStyle = HighlightStyle.define([
  { tag: t.comment, color: "#8c8c84" },
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: "#d8a18f" },
  { tag: [t.operator, t.punctuation], color: "#aba79b" },
  { tag: [t.string, t.attributeValue], color: "#a9b985" },
  { tag: t.escape, color: "#d8b580" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#c5a5b8" },
  { tag: t.regexp, color: "#b5b991" },
  { tag: [t.typeName, t.className, t.namespace], color: "#d8b580" },
  { tag: [t.tagName, t.angleBracket], color: "#d8a18f" },
  { tag: [t.attributeName, t.propertyName], color: "#a0b7aa" },
  { tag: t.meta, color: "#aba79b" },
  { tag: t.heading, color: "#d8b580", fontWeight: "bold" },
  { tag: t.link, color: "#a0b7aa", textDecoration: "underline" },
]);

export function themeExtension(theme: EditorTheme): Extension {
  if (theme === "projector-soft") return projectorTheme(true);
  if (theme === "projector") return projectorTheme(false);
  return oneDark;
}
export const themeCompartment = new Compartment();
export const languageCompartment = new Compartment();

export async function languageExtension(path: string): Promise<Extension> {
  const description = LanguageDescription.matchFilename(languages, path.split("/").at(-1) ?? path);
  return description ? await description.load() : [];
}

// --- Git dirty-diff gutter (VS Code "quick diff") -------------------------------------------

type Kind = "added" | "modified" | "deleted";
class DirtyMarker extends GutterMarker {
  readonly kind: Kind;
  readonly top: boolean;
  constructor(kind: Kind, top: boolean) {
    super();
    this.kind = kind;
    this.top = top;
  }
  eq(other: DirtyMarker) {
    return other.kind === this.kind && other.top === this.top;
  }
  toDOM() {
    const element = document.createElement("div");
    element.className = `git-gutter-${this.kind}${this.top ? " git-gutter-deleted-top" : ""}`;
    return element;
  }
}
export const setOriginal = StateEffect.define<string | null>();
const originalField = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setOriginal)) return effect.value;
    return value;
  },
});
const chunksField = StateField.define<readonly Chunk[]>({
  create: () => [],
  update(chunks, tr) {
    const original = tr.state.field(originalField);
    const changed = tr.effects.some((effect) => effect.is(setOriginal));
    if (!changed && !tr.docChanged) return chunks;
    if (original === null) return [];
    return Chunk.build(EditorState.create({ doc: original }).doc, tr.state.doc);
  },
});
function chunkKind(chunk: Chunk): Kind {
  return chunk.fromA === chunk.toA ? "added" : chunk.fromB === chunk.toB ? "deleted" : "modified";
}
const openPeek = StateEffect.define<number>();
const closePeek = StateEffect.define<null>();
/** Start of the change (position in the edited doc) whose Git-index text is shown inline. */
const peekField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(openPeek)) return effect.value;
      if (effect.is(closePeek)) return null;
    }
    return tr.docChanged || tr.effects.some((effect) => effect.is(setOriginal)) ? null : value;
  },
});
const chunkAt = (state: EditorState, line: { from: number }) =>
  state
    .field(chunksField)
    .find((item) => line.from >= item.fromB && line.from <= Math.max(item.fromB, item.endB - 1));
const lastLineEnd = (state: EditorState, chunk: Chunk) =>
  state.doc.lineAt(Math.max(chunk.fromB, Math.min(chunk.endB - 1, state.doc.length))).to;

function button(label: string, title: string, action: () => void) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "dirty-diff-button";
  element.textContent = label;
  element.title = title;
  element.addEventListener("mousedown", (event) => event.preventDefault());
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    action();
  });
  return element;
}
function highlighted(state: EditorState, text: string, body: HTMLElement) {
  body.textContent = text;
  const parser = state.facet(language)?.parser;
  if (!parser || !text) return;
  body.textContent = "";
  let at = 0;
  const put = (to: number, classes: string) => {
    const node = document.createTextNode(text.slice(at, to));
    if (!classes) body.append(node);
    else {
      const span = document.createElement("span");
      span.className = classes;
      span.append(node);
      body.append(span);
    }
    at = to;
  };
  highlightTree(
    parser.parse(text),
    { style: (tags) => highlightingFor(state, tags) },
    (from, to, classes) => {
      if (from > at) put(from, "");
      put(to, classes);
    },
  );
  if (at < text.length) put(text.length, "");
}
class PeekWidget extends WidgetType {
  readonly chunk: Chunk;
  readonly text: string;
  readonly index: number;
  readonly total: number;
  constructor(chunk: Chunk, text: string, index: number, total: number) {
    super();
    this.chunk = chunk;
    this.text = text;
    this.index = index;
    this.total = total;
  }
  eq(other: PeekWidget) {
    return (
      other.chunk.fromA === this.chunk.fromA &&
      other.chunk.fromB === this.chunk.fromB &&
      other.text === this.text &&
      other.index === this.index &&
      other.total === this.total
    );
  }
  get estimatedHeight() {
    return (this.text.split("\n").length + 1) * 20;
  }
  toDOM(view: EditorView) {
    const kind = chunkKind(this.chunk);
    const node = document.createElement("div");
    node.className = `dirty-diff-peek dirty-diff-peek-${kind}`;
    const bar = document.createElement("div");
    bar.className = "dirty-diff-bar";
    const title = document.createElement("span");
    title.className = "dirty-diff-title";
    title.textContent = `Изменение ${this.index + 1} из ${this.total}`;
    bar.append(
      title,
      button("↑", "Предыдущее изменение (Shift+Alt+F3)", () => step(-1)(view)),
      button("↓", "Следующее изменение (Alt+F3)", () => step(1)(view)),
      button("↶", "Откатить изменение", () => revert(view, this.chunk)),
      button("×", "Закрыть (Esc)", () => view.dispatch({ effects: closePeek.of(null) })),
    );
    node.append(bar);
    if (kind !== "added") {
      const body = document.createElement("div");
      body.className = "dirty-diff-body";
      highlighted(view.state, this.text.replace(/\n$/, ""), body);
      node.append(body);
    }
    return node;
  }
  ignoreEvent() {
    return true;
  }
}
const peekDecorations = EditorView.decorations.compute([peekField, chunksField], (state) => {
  const at = state.field(peekField);
  if (at === null) return Decoration.none;
  const chunks = state.field(chunksField);
  const index = chunks.findIndex((item) => item.fromB === at);
  const chunk = chunks[index];
  const original = state.field(originalField);
  if (!chunk || original === null) return Decoration.none;
  const widget = new PeekWidget(
    chunk,
    original.slice(chunk.fromA, chunk.toA),
    index,
    chunks.length,
  );
  const pos =
    chunkKind(chunk) === "deleted" ? chunkLineEnd(state, chunk) : lastLineEnd(state, chunk);
  return Decoration.set(Decoration.widget({ widget, block: true, side: 1 }).range(pos));
});
/** Deletions sit between lines: anchor the peek after the line preceding the removed text. */
function chunkLineEnd(state: EditorState, chunk: Chunk) {
  return chunk.fromB === 0 ? 0 : state.doc.lineAt(Math.min(chunk.fromB, state.doc.length)).to;
}
const dirtyGutter = gutter({
  class: "cm-dirty-gutter",
  markers(view) {
    const doc = view.state.doc;
    const ranges = [];
    for (const chunk of view.state.field(chunksField)) {
      const kind = chunkKind(chunk);
      if (kind === "deleted") {
        const top = chunk.fromB === 0;
        const line = doc.lineAt(Math.min(chunk.fromB, doc.length));
        ranges.push(new DirtyMarker(kind, top).range(top ? 0 : line.from));
        continue;
      }
      const first = doc.lineAt(chunk.fromB).number;
      const last = doc.lineAt(Math.max(chunk.fromB, chunk.endB - 1)).number;
      for (let n = first; n <= last; n++)
        ranges.push(new DirtyMarker(kind, false).range(doc.line(n).from));
    }
    return RangeSet.of(ranges, true);
  },
  lineMarkerChange: (update) =>
    update.docChanged ||
    update.transactions.some((tr) => tr.effects.some((e) => e.is(setOriginal))),
  initialSpacer: () => new DirtyMarker("added", false),
  domEventHandlers: {
    mousedown(view, line) {
      const doc = view.state.doc;
      const chunk =
        chunkAt(view.state, line) ??
        view.state
          .field(chunksField)
          .find(
            (item) =>
              chunkKind(item) === "deleted" &&
              doc.lineAt(Math.min(item.fromB, doc.length)).from === line.from,
          );
      if (!chunk) return false;
      const open = view.state.field(peekField) === chunk.fromB;
      view.dispatch({ effects: open ? closePeek.of(null) : openPeek.of(chunk.fromB) });
      return true;
    },
  },
});
/** Restores the Git-index text for one change. */
function revert(view: EditorView, chunk: Chunk) {
  const original = view.state.field(originalField);
  if (original === null) return;
  const text = original.slice(chunk.fromA, chunk.toA);
  view.dispatch({ changes: { from: chunk.fromB, to: chunk.toB, insert: text } });
}
function step(direction: 1 | -1) {
  return (view: EditorView) => {
    const chunks = view.state.field(chunksField);
    if (!chunks.length) return false;
    const peeked = view.state.field(peekField);
    const from = peeked ?? view.state.selection.main.head;
    const next =
      direction === 1
        ? (chunks.find((chunk) => chunk.fromB > from) ?? chunks[0])
        : (chunks.findLast((chunk) => chunk.fromB < from) ?? chunks.at(-1)!);
    const anchor = Math.min(next.fromB, view.state.doc.length);
    view.dispatch({
      selection: { anchor },
      effects: [openPeek.of(next.fromB), EditorView.scrollIntoView(anchor, { y: "center" })],
    });
    return true;
  };
}
export const dirtyDiff: Extension = [
  originalField,
  chunksField,
  peekField,
  peekDecorations,
  dirtyGutter,
  Prec.high(
    keymap.of([
      { key: "Alt-F3", run: step(1) },
      { key: "Shift-Alt-F3", run: step(-1) },
      {
        key: "Escape",
        run: (view) => {
          if (view.state.field(peekField) === null) return false;
          view.dispatch({ effects: closePeek.of(null) });
          return true;
        },
      },
    ]),
  ),
];
