import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { chipText, normalizeParts } from "../message-parts.ts";
import type { MessageChip, MessagePart } from "../../model/types.ts";

/** Lucide icon bodies (24×24 stroke paths): a widget is plain DOM, so it cannot use components. */
const icons: Record<MessageChip["type"] | "directory", string> = {
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  directory:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  image:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  command:
    '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
};

export function chipIcon(chip: MessageChip): string {
  const body = icons[chip.type === "file" && chip.directory ? "directory" : chip.type];
  return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** The short name a chip shows: the file name, the command, the image name. */
export function chipLabel(chip: MessageChip): string {
  if (chip.type === "file") return chip.path.replace(/\/$/, "").split("/").pop() || chip.path;
  if (chip.type === "command") return `/${chip.name}`;
  return chip.name;
}

export function chipTitle(chip: MessageChip): string {
  return chip.type === "file" ? chip.path : chip.type === "command" ? `/${chip.name}` : chip.name;
}

class ChipWidget extends WidgetType {
  readonly chip: MessageChip;
  constructor(chip: MessageChip) {
    super();
    this.chip = chip;
  }
  eq(other: ChipWidget) {
    return chipText(other.chip) === chipText(this.chip);
  }
  toDOM() {
    const element = document.createElement("span");
    element.className = `composer-chip ${this.chip.type}`;
    element.title = chipTitle(this.chip);
    element.dataset.chip = JSON.stringify(this.chip);
    element.innerHTML = chipIcon(this.chip);
    const label = document.createElement("span");
    label.className = "composer-chip-label";
    label.textContent = chipLabel(this.chip);
    element.append(label);
    return element;
  }
  ignoreEvent() {
    return false;
  }
}

/** Puts a chip over `from..to`, the text it stands for. */
export const putChip = StateEffect.define<{ from: number; to: number; chip: MessageChip }>();

const chipField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(chips, transaction) {
    let next = chips.map(transaction.changes);
    // A chip whose text was edited from the inside (a partial selection delete) is only text now.
    next = next.update({
      filter: (from, to, value) =>
        to - from === chipText((value.spec.widget as ChipWidget).chip).length,
    });
    for (const effect of transaction.effects)
      if (effect.is(putChip))
        next = next.update({
          add: [
            Decoration.replace({ widget: new ChipWidget(effect.value.chip) }).range(
              effect.value.from,
              effect.value.to,
            ),
          ],
        });
    return next;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

/** What `chipField` holds, in document order. */
function chipRanges(state: EditorState) {
  const found: { from: number; to: number; chip: MessageChip }[] = [];
  state.field(chipField).between(0, state.doc.length, (from, to, value) => {
    found.push({ from, to, chip: (value.spec.widget as ChipWidget).chip });
  });
  return found;
}

/** The document as a message: text and chips in order. */
export function contentOf(state: EditorState): MessagePart[] {
  const parts: MessagePart[] = [];
  let at = 0;
  for (const { from, to, chip } of chipRanges(state)) {
    if (from > at) parts.push({ type: "text", text: state.doc.sliceString(at, from) });
    parts.push(chip);
    at = to;
  }
  if (at < state.doc.length) parts.push({ type: "text", text: state.doc.sliceString(at) });
  return normalizeParts(parts);
}

/** Replaces the whole document with a message, chips included. */
export function setContent(view: EditorView, parts: readonly MessagePart[]) {
  let text = "";
  const chips: { from: number; to: number; chip: MessageChip }[] = [];
  for (const part of parts) {
    if (part.type === "text") text += part.text;
    else {
      const token = chipText(part);
      chips.push({ from: text.length, to: text.length + token.length, chip: part });
      text += token;
    }
  }
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    effects: chips.map((item) => putChip.of(item)),
    selection: EditorSelection.cursor(text.length),
  });
}

/** Replaces `from..to` with a chip and the space after it, and puts the cursor behind that. */
export function insertChip(view: EditorView, from: number, to: number, chip: MessageChip) {
  const token = chipText(chip);
  view.dispatch({
    changes: { from, to, insert: `${token} ` },
    effects: putChip.of({ from, to: from + token.length, chip }),
    selection: EditorSelection.cursor(from + token.length + 1),
    userEvent: "input.complete",
  });
}

/** Backspace and Delete next to a chip remove all of it, not a letter of its text. */
function removeAdjacent(forward: boolean) {
  return (view: EditorView) => {
    const { main } = view.state.selection;
    if (!main.empty) return false;
    const hit = chipRanges(view.state).find((item) =>
      forward ? item.from === main.head : item.to === main.head,
    );
    if (!hit) return false;
    view.dispatch({ changes: { from: hit.from, to: hit.to }, userEvent: "delete" });
    return true;
  };
}
export const deleteChipBackward = removeAdjacent(false);
export const deleteChipForward = removeAdjacent(true);

export const chipExtensions: Extension = [chipField];
