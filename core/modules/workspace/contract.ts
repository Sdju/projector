export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
}
export interface FileContent {
  path: string;
  content: string;
}
export interface SearchHit {
  path: string;
  line: number;
  column: number;
  text: string;
}
export interface GitChange {
  path: string;
  originalPath?: string;
  index: string;
  worktree: string;
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
