export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  executable?: boolean;
  ignored?: boolean;
  disabled?: boolean;
}
export interface FileContent {
  path: string;
  content: string;
  archive?: ArchiveContent;
  readonly?: boolean;
  binary?: boolean;
  size?: number;
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

export interface GitBranch {
  /** Short name: `main`, or `origin/main` for a remote-tracking branch. */
  name: string;
  kind: "local" | "remote";
  current: boolean;
  /** Short name of the upstream of a local branch; empty when there is none. */
  upstream: string;
  /** The configured upstream no longer exists. */
  gone: boolean;
  ahead: number;
  behind: number;
  /** Local branch fully merged into HEAD, so it can be deleted without force. */
  merged: boolean;
  hash: string;
  subject: string;
  /** ISO 8601 committer date of the tip. */
  date: string;
}
export interface GitBranches {
  available: boolean;
  /** Current branch name, or the short hash while HEAD is detached. */
  current: string;
  detached: boolean;
  branches: GitBranch[];
}

export interface IssueLabel {
  name: string;
  /** Hex color without the leading `#`. */
  color: string;
}
export interface IssueUser {
  login: string;
  avatarUrl: string;
}
export interface Issue {
  number: number;
  title: string;
  state: "open" | "closed";
  author: IssueUser;
  labels: IssueLabel[];
  assignees: IssueUser[];
  /** Number of comments reported by the host. */
  comments: number;
  body: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}
export interface IssueComment {
  id: number;
  author: IssueUser;
  body: string;
  htmlUrl: string;
  createdAt: string;
}
export interface IssueList {
  issues: Issue[];
  /** Page number of the next page, or null when the list is complete. */
  next: number | null;
}
export interface IssueDetail {
  issue: Issue;
  comments: IssueComment[];
  /** The host returned more comments than the reader loads at once. */
  commentsTruncated: boolean;
}

export type PullRequestState = "open" | "closed" | "merged";
export interface PullRequest {
  number: number;
  title: string;
  /** `merged` is a closed pull request that landed (`merged_at` set). */
  state: PullRequestState;
  draft: boolean;
  author: IssueUser;
  labels: IssueLabel[];
  /** Source branch; `owner:branch` for a fork. */
  head: string;
  base: string;
  body: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}
export interface PullRequestList {
  pulls: PullRequest[];
  /** Page number of the next page, or null when the list is complete. */
  next: number | null;
}
export interface PullRequestFile {
  path: string;
  /** Previous path of a renamed file. */
  previousPath: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
}
export interface PullRequestReview {
  id: number;
  author: IssueUser;
  state: "approved" | "changes_requested" | "commented" | "dismissed" | "pending";
  body: string;
  htmlUrl: string;
  submittedAt: string;
}
export interface PullRequestDetail {
  pull: PullRequest;
  commits: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** Conversation comments (not inline review comments). */
  comments: IssueComment[];
  reviews: PullRequestReview[];
  files: PullRequestFile[];
  /** The host returned more comments or files than the reader loads at once. */
  commentsTruncated: boolean;
  filesTruncated: boolean;
}

export interface Discussion {
  number: number;
  title: string;
  closed: boolean;
  /** An answer was marked in a Q&A discussion. */
  answered: boolean;
  author: IssueUser;
  category: { name: string; emoji: string };
  labels: IssueLabel[];
  /** Number of top-level comments reported by the host. */
  comments: number;
  upvotes: number;
  body: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}
export interface DiscussionList {
  discussions: Discussion[];
  /** Cursor of the next page, or null when the list is complete. */
  next: string | null;
}
export interface DiscussionComment {
  id: number;
  author: IssueUser;
  body: string;
  htmlUrl: string;
  createdAt: string;
  upvotes: number;
  /** Marked as the answer of the discussion. */
  isAnswer: boolean;
  /** Replies are one level deep; the host does not nest further. */
  replies: DiscussionComment[];
  /** The comment has more replies than the reader loads. */
  repliesTruncated: boolean;
}
export interface DiscussionDetail {
  discussion: Discussion;
  comments: DiscussionComment[];
  commentsTruncated: boolean;
}
