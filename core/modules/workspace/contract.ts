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

export interface GitRef {
  name: string;
  kind: "head" | "branch" | "remote" | "tag";
}
export interface GitCommit {
  hash: string;
  parents: string[];
  subject: string;
  author: string;
  email: string;
  /** ISO 8601 author date. */
  date: string;
  refs: GitRef[];
  /** The commit is reachable from HEAD but not from its upstream. */
  unpushed: boolean;
}
/** One page of history; `next` is the `skip` of the following page. */
export interface GitLog {
  available: boolean;
  head: string;
  upstream: string;
  ahead: number;
  behind: number;
  /** `user.email` of the repository, to dim the author of one's own commits. */
  me: string;
  commits: GitCommit[];
  next: number | null;
}
export interface GitCommitFile {
  path: string;
  originalPath?: string;
  /** A, M, D, R, C or T. */
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
}
export interface GitCommitDetail extends Omit<GitCommit, "unpushed"> {
  body: string;
  committer: string;
  committerDate: string;
  additions: number;
  deletions: number;
  /** Changes of this commit against its first parent, limited to the project folder. */
  files: GitCommitFile[];
}
export interface CommitComparison {
  path: string;
  original: string;
  modified: string;
  hash: string;
  /** Short hash of the first parent; empty for a root commit. */
  parent: string;
}
