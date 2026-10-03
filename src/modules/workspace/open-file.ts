import type { FileContent } from "../../../core/modules/workspace/index.ts";

export interface OpenFile extends FileContent {
  virtual?: "keybindings" | "agent" | "project";
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

export const isEditable = (file: OpenFile) =>
  !file.virtual && !file.external && !file.image && !file.archive && file.original === undefined;
export const isMarkdown = (file: OpenFile) =>
  isEditable(file) && /\.(?:md|markdown)$/i.test(file.path);
