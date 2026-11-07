import { provide, shallowRef, type ShallowRef } from "vue";

/** The lines the focused editor has selected, or the line under its cursor. */
export interface EditorRange {
  path: string;
  /** First line, counted from 1. */
  from: number;
  /** Last line, counted from 1 and included. */
  to: number;
}

export interface EditorSelectionStore {
  /** What the last focused editor reported; absent until an editor takes focus. */
  current: ShallowRef<EditorRange | undefined>;
  report(range: EditorRange): void;
  /** An editor went away: only its own report is forgotten. */
  clear(path: string): void;
}

export function createEditorSelection(): EditorSelectionStore {
  const current = shallowRef<EditorRange>();
  return {
    current,
    report(range) {
      current.value = { ...range };
    },
    clear(path) {
      if (current.value?.path === path) current.value = undefined;
    },
  };
}

/** Global symbol: viewers inject the store without importing the workspace implementation. */
const editorSelectionKey = Symbol.for("projector.editor-selection");

/** The workspace owns one store: commands ask it for the lines the user just worked with. */
export function provideEditorSelection(store = createEditorSelection()): EditorSelectionStore {
  provide(editorSelectionKey, store);
  return store;
}
