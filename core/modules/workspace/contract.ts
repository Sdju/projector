export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  executable?: boolean;
}
export interface FileContent {
  path: string;
  content: string;
  archive?: ArchiveContent;
}
export interface ArchiveEntry {
  path: string;
  type: "file" | "directory" | "symlink" | "hardlink" | "other";
  size: number;
  modified?: string;
  link?: string;
}
export interface ArchiveContent {
  format: string;
  size: number;
  entries: ArchiveEntry[];
  truncated: boolean;
}
export interface SearchMatch {
  /** Character offsets (UTF-16 code units) into the hit text. */
  start: number;
  end: number;
}
export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}
export interface SearchHit {
  path: string;
  line: number;
  column: number;
  text: string;
  matches: SearchMatch[];
}
export interface GitChange {
  path: string;
  originalPath?: string;
  index: string;
  worktree: string;
  executable?: boolean;
}
export interface GitOverview {
  available: boolean;
  branch: string;
  changes: GitChange[];
}
export interface FileComparison {
  path: string;
  original: string;
  modified: string;
  staged: boolean;
}
/** Index text of a tracked file; the editor diffs against it live, like VS Code. */
export interface GitGutter {
  available: boolean;
  original: string;
}
