import { inject } from "vue";

export interface EditorSelectionRange {
  path: string;
  from?: number;
  to?: number;
  text?: string;
}

/** The workspace's selection store; the key is global so viewers do not import the command layer. */
export interface EditorSelectionSink {
  report(range: EditorSelectionRange): void;
  clear(path: string): void;
  /** Adds the current range to the agent chat. */
  add(): void;
}

export function injectEditorSelection(): EditorSelectionSink | undefined {
  return inject<EditorSelectionSink | undefined>(
    Symbol.for("projector.editor-selection"),
    undefined,
  );
}
