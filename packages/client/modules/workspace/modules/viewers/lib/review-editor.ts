import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from "@codemirror/view";
import { EditorState, RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import "./review-editor.css";
import {
  ReviewCommentWidget,
  ReviewComposerWidget,
  type InlineReviewComment,
  type ReviewEditorHandlers,
} from "./review-widgets.ts";

export type { InlineReviewComment, ReviewEditorHandlers };

export interface InlineReviewState {
  comments: readonly InlineReviewComment[];
  composing?: { from: number; to: number };
  editing?: string;
}

export const setReviewState = StateEffect.define<InlineReviewState>();

const emptyState: InlineReviewState = { comments: [] };

const reviewField = StateField.define<InlineReviewState>({
  create: () => emptyState,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setReviewState)) return effect.value;
    return value;
  },
});

function clampLine(state: EditorState, line: number) {
  return Math.max(1, Math.min(line, state.doc.lines));
}

/** Captures up to four lines from the document for showing context in the review summary. */
export function extractSnippet(state: EditorState, from: number, to: number) {
  const start = clampLine(state, from);
  const end = Math.max(start, clampLine(state, to));
  const lines: string[] = [];
  for (let n = start; n <= Math.min(end, start + 3); n++) {
    lines.push(state.doc.line(n).text);
  }
  return lines.join("\n");
}

class ReviewGutterMarker extends GutterMarker {
  readonly count: number;
  constructor(count: number) {
    super();
    this.count = count;
  }
  eq(other: ReviewGutterMarker) {
    return other.count === this.count;
  }
  toDOM() {
    const badge = document.createElement("span");
    badge.className = "cm-review-marker";
    badge.textContent = this.count > 1 ? String(this.count) : "";
    badge.title =
      this.count > 1
        ? `Замечаний на строке: ${this.count}. Нажмите, чтобы добавить ещё`
        : "Есть замечание. Нажмите, чтобы добавить ещё";
    return badge;
  }
}

function buildDecorations(state: EditorState, handlers: ReviewEditorHandlers): DecorationSet {
  const review = state.field(reviewField);
  if (!review.comments.length && !review.composing) return Decoration.none;

  const ranges = [];
  const commentedLines = new Set<number>();
  const composingLines = new Set<number>();

  if (review.composing) {
    const start = clampLine(state, review.composing.from);
    const end = Math.max(start, clampLine(state, review.composing.to));
    for (let n = start; n <= end; n++) composingLines.add(n);
  }

  for (const comment of review.comments) {
    const start = clampLine(state, comment.from);
    const end = Math.max(start, clampLine(state, comment.to));
    for (let n = start; n <= end; n++) {
      if (!composingLines.has(n)) commentedLines.add(n);
    }
    const anchor = state.doc.line(end).to;
    const widget =
      review.editing === comment.id
        ? new ReviewComposerWidget({
            mode: "edit",
            from: comment.from,
            to: comment.to,
            commentId: comment.id,
            initialText: comment.text,
            handlers,
          })
        : new ReviewCommentWidget(comment, handlers);
    ranges.push(Decoration.widget({ widget, block: true, side: 1 }).range(anchor));
  }

  for (const n of commentedLines) {
    ranges.push(Decoration.line({ class: "cm-review-line" }).range(state.doc.line(n).from));
  }
  for (const n of composingLines) {
    ranges.push(
      Decoration.line({ class: "cm-review-line cm-review-line-composing" }).range(
        state.doc.line(n).from,
      ),
    );
  }

  if (review.composing) {
    const end = Math.max(
      clampLine(state, review.composing.from),
      clampLine(state, review.composing.to),
    );
    const anchor = state.doc.line(end).to;
    const widget = new ReviewComposerWidget({
      mode: "create",
      from: review.composing.from,
      to: review.composing.to,
      handlers,
    });
    ranges.push(Decoration.widget({ widget, block: true, side: 2 }).range(anchor));
  }

  return Decoration.set(ranges, true);
}

/** Inline review decorations and optional diff gutter (+) for CodeMirror. */
export function reviewEditorExtension(
  handlers: ReviewEditorHandlers,
  options: { showGutter: boolean },
): Extension {
  const decorations = EditorView.decorations.compute([reviewField], (state) =>
    buildDecorations(state, handlers),
  );
  if (!options.showGutter) return [reviewField, decorations];

  const reviewGutter = gutter({
    class: "cm-review-gutter",
    renderEmptyElements: true,
    markers(view) {
      const review = view.state.field(reviewField);
      if (!review.comments.length) return RangeSet.empty;
      const counts = new Map<number, number>();
      for (const comment of review.comments) {
        const lineNo = clampLine(view.state, comment.from);
        counts.set(lineNo, (counts.get(lineNo) ?? 0) + 1);
      }
      const ranges = [...counts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([lineNo, count]) =>
          new ReviewGutterMarker(count).range(view.state.doc.line(lineNo).from),
        );
      return RangeSet.of(ranges, true);
    },
    lineMarkerChange: (update) =>
      update.docChanged ||
      update.transactions.some((tr) => tr.effects.some((e) => e.is(setReviewState))),
    domEventHandlers: {
      mousedown(view, line) {
        const lineNo = view.state.doc.lineAt(line.from).number;
        handlers.onStart(lineNo, lineNo, extractSnippet(view.state, lineNo, lineNo));
        return true;
      },
    },
  });

  return [reviewField, decorations, reviewGutter];
}
