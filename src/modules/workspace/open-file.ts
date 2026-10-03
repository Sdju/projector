import type { FileContent } from "../../../core/modules/workspace/index.ts";

export interface OpenFile extends FileContent {
  virtual?: "keybindings" | "agent" | "project" | "commit";
  /** Полный хеш: вкладка обзора коммита или diff файла в этом коммите. */
  commit?: string;
  /** Короткий хеш родителя в diff коммита; пусто у корневого коммита. */
  parent?: string;
  external?: boolean;
  image?: string;
  localFile?: File;
  original?: string;
  staged?: boolean;
  line?: number;
  column?: number;
  key: string;
  draft?: string;
  markdownMode?: "document" | "source";
  saving?: boolean;
  saveError?: string;
}

/** Diff against the Git index shows the real file on the right, so it can be edited in place. */
export const isEditable = (file: OpenFile) =>
  !file.virtual &&
  !file.external &&
  !file.image &&
  !file.archive &&
  (file.original === undefined || file.staged === false);
export const isMarkdown = (file: OpenFile) =>
  isEditable(file) && file.original === undefined && /\.(?:md|markdown)$/i.test(file.path);
