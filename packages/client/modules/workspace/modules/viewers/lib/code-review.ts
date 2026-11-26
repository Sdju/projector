import { computed, inject, watch } from "vue";
import { EditorView } from "@codemirror/view";
import type { StateEffect } from "@codemirror/state";
import { reviewEditorExtension, setReviewState, type InlineReviewState } from "./review-editor.ts";

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
export function useCodeReview(
  props: { path: string; staged?: boolean; original?: string },
  liveFile: () => boolean,
  editor: () => EditorView | undefined,
) {
  const review = inject<ReviewSink | undefined>(Symbol.for("projector.review"), undefined);
  const matchesSide = (staged?: boolean) =>
    props.staged === true ? staged === true : staged !== true;
  /** Diffs always allow commenting; plain files offer it once a review has remarks. */
  const tracksReview = () =>
    liveFile() && !!review && (props.original !== undefined || review.comments.value.length > 0);

  const fileReviewCount = computed(() =>
    liveFile() && review ? review.commentsFor(props.path, props.staged).length : 0,
  );
  const totalReviewCount = computed(() =>
    liveFile() && review ? review.comments.value.length : 0,
  );
  const showReviewIndicator = computed(
    () => fileReviewCount.value > 0 || (props.original !== undefined && totalReviewCount.value > 0),
  );

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
    const view = editor();
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
  return {
    review,
    tracksReview,
    fileReviewCount,
    totalReviewCount,
    showReviewIndicator,
    syncReview,
    reviewExtensionFor,
  };
}
