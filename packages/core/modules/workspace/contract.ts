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
  /** The file was not read: it is this many bytes, and the user is asked before it is opened. */
  large?: number;
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
/** Two sides of a file compared between snapshots; no working-copy state is involved. */
export interface FileSides {
  path: string;
  original: string;
  modified: string;
  binary?: boolean;
  tooLarge?: boolean;
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

/** Reaction names of the GitHub REST API (`laugh` is 😄, `hooray` is 🎉). */
export type ReactionKind =
  | "+1"
  | "-1"
  | "laugh"
  | "hooray"
  | "confused"
  | "heart"
  | "rocket"
  | "eyes";
/** Only reactions somebody left; the host's zero counters are dropped. */
export interface Reaction {
  content: ReactionKind;
  count: number;
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
  reactions: Reaction[];
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}
export interface IssueComment {
  id: number;
  author: IssueUser;
  body: string;
  reactions: Reaction[];
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

/** Host-neutral CI status: GitLab statuses and GitHub conclusions map into this set. */
export type PipelineStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "canceled"
  | "skipped"
  | "manual"
  | "unknown";
export interface Pipeline {
  id: number;
  /** Display name of a workflow; empty when the host names runs only by id. */
  name: string;
  status: PipelineStatus;
  /** What started the run: a GitLab source (`push`, `web`, …) or a GitHub event. */
  source: string;
  ref: string;
  sha: string;
  author: IssueUser;
  webUrl: string;
  createdAt: string;
  updatedAt: string;
  /** Seconds reported by the host, or null while it has not finished. */
  duration: number | null;
}
export interface PipelineJob {
  id: number;
  pipelineId: number;
  name: string;
  stage: string;
  status: PipelineStatus;
  ref: string;
  webUrl: string;
  createdAt: string;
  startedAt: string;
  finishedAt: string;
  /** Seconds reported by the host, or null while it has not finished. */
  duration: number | null;
  allowFailure: boolean;
  failureReason: string;
}
export interface PipelineList {
  pipelines: Pipeline[];
  /** Page number of the next page, or null when the list is complete. */
  next: number | null;
}
export interface PipelineDetail {
  pipeline: Pipeline;
  jobs: PipelineJob[];
  /** The host returned more jobs than the reader loads at once. */
  jobsTruncated: boolean;
}
export interface PipelineJobDetail {
  job: PipelineJob;
  log: string;
  /** The trace is longer than the reader loads or was not available. */
  logTruncated: boolean;
}

/** One downloadable entry of a release: an uploaded asset, a hosted link or a source archive. */
export interface ReleaseAsset {
  /** Stable id inside the release: GitHub asset id, GitLab link id or `source:<format>`. */
  id: string;
  name: string;
  /** Bytes reported by the host, or null when it does not report a size. */
  size: number | null;
  /** Downloads reported by the host, or null when it does not report a count. */
  downloads: number | null;
  contentType: string;
  /** Projector download URL for hosted files; the host URL for external links. */
  url: string;
  /** The browser opens the host instead of downloading through Projector. */
  external: boolean;
  /** The host is still uploading this asset. */
  uploading: boolean;
  /** A source archive generated by the host rather than an attached file. */
  source: boolean;
  /** Digest reported by the host (`sha256:…`) or empty. */
  digest: string;
}
export interface Release {
  /** Host id: a GitHub numeric id or a GitLab tag. */
  id: string;
  tag: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  /** GitLab marks releases scheduled for a future date. */
  upcoming: boolean;
  author: IssueUser;
  createdAt: string;
  releasedAt: string;
  htmlUrl: string;
  /** Attached files or links; generated source archives are not counted. */
  assetCount: number;
  /** Downloads reported by the host, or null when the host does not report them. */
  downloads: number | null;
}
export interface ReleaseList {
  releases: Release[];
  /** Page number of the next page, or null when the list is complete. */
  next: number | null;
  /** Tag the host considers the latest release, or empty when it has no such notion. */
  latestTag: string;
}
export interface ReleaseDetail {
  release: Release;
  body: string;
  /** Attached files, links and generated source archives. */
  assets: ReleaseAsset[];
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
  reactions: Reaction[];
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
  reactions: Reaction[];
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
