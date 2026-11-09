import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { insertChip } from "./chips.ts";
import { chipText } from "../message-parts.ts";
import type { MessageChip } from "../../model/types.ts";

/** Inserts chips one after another at `at`, leaving a separating space after each. */
export function insertDropped(target: EditorView, chips: MessageChip[], at: number) {
  let position = at;
  for (const chip of chips) {
    insertChip(target, position, position, chip);
    position += chipText(chip).length + 1;
  }
}

export function insertChips(target: EditorView, chips: MessageChip[]) {
  insertDropped(target, chips, target.state.selection.main.head);
  target.focus();
}

/** Appends chips after the whole draft, with a separating space when the text ends with a word. */
export function appendChips(target: EditorView, chips: MessageChip[]) {
  let position = target.state.doc.length;
  const text = target.state.doc.toString();
  if (text && !/\s$/.test(text)) {
    target.dispatch({
      changes: { from: position, insert: " " },
      selection: EditorSelection.cursor(position + 1),
    });
    position += 1;
  }
  insertDropped(target, chips, position);
  target.focus();
}

/** Appends selected text after the whole draft, separated by a blank line. */
export function appendText(target: EditorView, value: string) {
  const text = value.trim();
  if (!text) return;
  const current = target.state.doc.toString();
  const separator = !current
    ? ""
    : current.endsWith("\n\n")
      ? ""
      : current.endsWith("\n")
        ? "\n"
        : "\n\n";
  const at = target.state.doc.length;
  target.dispatch({
    changes: { from: at, insert: separator + text },
    selection: EditorSelection.cursor(at + separator.length + text.length),
    userEvent: "input.paste",
  });
  target.focus();
}

/** Inserts a quote at the cursor, separated from the text around it by a blank line. */
export function insertQuote(target: EditorView, value: string) {
  const text = value.trim();
  if (!text) return;
  const { from, to } = target.state.selection.main;
  const before = target.state.doc.sliceString(0, from);
  const after = target.state.doc.sliceString(to);
  const prefix = !before
    ? ""
    : before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const suffix = !after
    ? "\n\n"
    : after.startsWith("\n\n")
      ? ""
      : after.startsWith("\n")
        ? "\n"
        : "\n\n";
  const insert = prefix + text + suffix;
  target.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + prefix.length + text.length + suffix.length),
    userEvent: "input.paste",
  });
  target.focus();
}
