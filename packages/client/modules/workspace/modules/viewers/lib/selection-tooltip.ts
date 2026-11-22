import {
  EditorView,
  ViewPlugin,
  showTooltip,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { extractSnippet } from "./review-editor.ts";

export function selectionLines(state: EditorState) {
  const { main } = state.selection;
  const first = state.doc.lineAt(main.from);
  let last = state.doc.lineAt(main.to);
  // A selection ending at the start of the next line does not include that line.
  if (main.to > main.from && last.from === main.to && last.number > first.number)
    last = state.doc.line(last.number - 1);
  return { from: first.number, to: last.number };
}

/** A selection is settled only after the pointer is released or typing stops: no button mid-drag. */
const selectionSettled = StateEffect.define<boolean>();
const selectionSettledField = StateField.define<boolean>({
  create: () => true,
  update(settled, transaction) {
    let next = settled;
    if (transaction.selection) next = transaction.state.selection.main.empty;
    for (const effect of transaction.effects) if (effect.is(selectionSettled)) next = effect.value;
    return next;
  },
});

const selectionSettlePlugin = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private pointerDown = false;
    private readonly view: EditorView;
    private readonly onMouseDown: (event: MouseEvent) => void;
    private readonly onMouseUp: () => void;
    constructor(view: EditorView) {
      this.view = view;
      const doc = view.dom.ownerDocument;
      this.onMouseDown = (event) => {
        const target = event.target;
        if (!(target instanceof Node) || !view.dom.contains(target)) return;
        // The button itself keeps the selection: do not hide it in its own mousedown.
        if (target instanceof Element && target.closest(".selection-chat")) return;
        if (target instanceof Element && target.closest(".cm-review-slot")) return;
        this.pointerDown = true;
        this.clear();
        view.dispatch({ effects: selectionSettled.of(false) });
      };
      this.onMouseUp = () => {
        if (!this.pointerDown) return;
        this.pointerDown = false;
        this.schedule(120);
      };
      doc.addEventListener("mousedown", this.onMouseDown, true);
      doc.addEventListener("mouseup", this.onMouseUp, true);
    }
    private clear() {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    private schedule(delay: number) {
      this.clear();
      this.timer = setTimeout(() => {
        this.timer = undefined;
        if (!this.view.state.selection.main.empty)
          this.view.dispatch({ effects: selectionSettled.of(true) });
      }, delay);
    }
    update(update: ViewUpdate) {
      if (!update.selectionSet) return;
      this.clear();
      if (update.state.selection.main.empty) return;
      if (!this.pointerDown) this.schedule(180);
    }
    destroy() {
      this.clear();
      const doc = this.view.dom.ownerDocument;
      doc.removeEventListener("mousedown", this.onMouseDown, true);
      doc.removeEventListener("mouseup", this.onMouseUp, true);
    }
  },
);

function actionButton(label: string, title: string, onClick: () => void, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = extraClass ? `selection-chat ${extraClass}` : "selection-chat";
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", onClick);
  return button;
}

export interface SelectionTooltipHandlers {
  canChat: () => boolean;
  canReview: () => boolean;
  onChat: () => void;
  onReview: (range: { from: number; to: number; snippet: string }) => void;
}

/** Buttons at the end of a non-empty selection: to chat, and a review remark on diffs. */
export function selectionActionsTooltip(handlers: SelectionTooltipHandlers): Extension {
  const field = StateField.define<readonly Tooltip[]>({
    create: () => [],
    update(_tooltips, transaction) {
      const range = transaction.state.selection.main;
      if (range.empty || !transaction.state.field(selectionSettledField)) return [];
      const chat = handlers.canChat();
      const comment = handlers.canReview();
      if (!chat && !comment) return [];
      const { from, to } = selectionLines(transaction.state);
      return [
        {
          // Anchor to the cursor end, not to the end of the range: a backwards selection
          // must show the button where the user actually is.
          pos: range.head,
          above: false,
          create: (cmView: EditorView) => {
            const wrap = document.createElement("div");
            wrap.className = "selection-actions";
            wrap.addEventListener("mousedown", (event) => event.preventDefault());
            if (chat) {
              wrap.append(
                actionButton("В чат", "Добавить выделенные строки в чат агента", handlers.onChat),
              );
            }
            if (comment) {
              const label = from === to ? "Замечание" : `Замечание · ${from}–${to}`;
              wrap.append(
                actionButton(
                  label,
                  "Оставить замечание к выделенным строкам",
                  () => {
                    const lines = selectionLines(cmView.state);
                    const snippet = extractSnippet(cmView.state, lines.from, lines.to);
                    cmView.dispatch({ effects: selectionSettled.of(false) });
                    handlers.onReview({ ...lines, snippet });
                  },
                  "selection-review",
                ),
              );
            }
            return { dom: wrap };
          },
        },
      ];
    },
  });
  return [
    selectionSettledField,
    selectionSettlePlugin,
    field,
    showTooltip.computeN([field], (state) => state.field(field)),
  ];
}
