import type {
  CommitComparison,
  DiscussionDetail,
  DiscussionList,
  FileChangeList,
  FileComparison,
  FileContent,
  FileSides,
  GitBranches,
  GitCommitDetail,
  GitGutter,
  GitLog,
  GitOverview,
  IssueDetail,
  IssueList,
  PipelineDetail,
  PipelineJobDetail,
  PipelineList,
  ProjectPath,
  PullRequestChanges,
  PullRequestComparison,
  PullRequestDetail,
  PullRequestList,
  ReleaseDetail,
  ReleaseList,
  SearchHit,
  TrashDirectory,
  TrashList,
  TrashSizes,
  TreePage,
} from "@ai-projector/core/modules/workspace/index.ts";

export type WorkspaceParams = Record<string, string>;

/** Провайдер профиля, который обслуживает действие чтения. */
export type WorkspaceReadDomain =
  | "files"
  | "git"
  | "search"
  | "issues"
  | "pulls"
  | "discussions"
  | "pipelines"
  | "releases";

/** Размер и содержимое записи проекта (`info`). */
export interface WorkspaceEntryInfo {
  path: string;
  name: string;
  directory: boolean;
  size: number;
  files: number;
  directories: number;
  links: number;
  skipped: number;
  modified: string | null;
  truncated: boolean;
}

/**
 * Контракт действий чтения: имя действия связывает параметры и тип ответа, поэтому `T`
 * больше не задаётся вызовом. Провайдеры остаются строковым рантайм-границей, а публичный
 * транспорт (`workspaceRequest`) проверяет вызов по этой карте.
 */
export interface WorkspaceReadActions {
  root: { params: WorkspaceParams; result: { root: string } };
  tree: {
    params: WorkspaceParams & {
      path?: string;
      rev?: string;
      offset?: string;
      limit?: string;
      reveal?: string;
    };
    result: TreePage;
  };
  file: {
    params: WorkspaceParams & { path: string; rev?: string; ask?: string };
    result: FileContent & { image?: boolean };
  };
  info: { params: WorkspaceParams & { path: string }; result: WorkspaceEntryInfo };
  trash: { params: WorkspaceParams & { path?: string }; result: TrashList | TrashDirectory };
  "trash-sizes": { params: WorkspaceParams & { path?: string }; result: TrashSizes };
  external: { params: WorkspaceParams & { path: string; ask?: string }; result: FileContent };
  changes: { params: WorkspaceParams & { from: string; to: string }; result: FileChangeList };
  "compare-file": {
    params: WorkspaceParams & { from: string; to: string; path: string; originalPath?: string };
    result: FileSides;
  };
  search: {
    params: WorkspaceParams & {
      q: string;
      case?: string;
      word?: string;
      regex?: string;
      rev?: string;
    };
    result: { hits: SearchHit[]; truncated: boolean };
  };
  paths: {
    params: WorkspaceParams & { q: string; limit?: string; rev?: string };
    result: { paths: ProjectPath[] };
  };
  git: { params: WorkspaceParams; result: GitOverview };
  branches: { params: WorkspaceParams; result: GitBranches };
  log: {
    params: WorkspaceParams & {
      skip?: string;
      limit?: string;
      q?: string;
      all?: string;
    };
    result: GitLog;
  };
  commit: { params: WorkspaceParams & { hash: string }; result: GitCommitDetail };
  "commit-diff": {
    params: WorkspaceParams & { hash: string; path: string; originalPath?: string };
    result: CommitComparison;
  };
  gutter: { params: WorkspaceParams & { path: string }; result: GitGutter };
  diff: { params: WorkspaceParams & { path: string; staged?: string }; result: FileComparison };
  issues: {
    params: WorkspaceParams & { state?: string; page?: string };
    result: IssueList;
  };
  issue: { params: WorkspaceParams & { number: string }; result: IssueDetail };
  pulls: {
    params: WorkspaceParams & { state?: string; page?: string };
    result: PullRequestList;
  };
  pull: { params: WorkspaceParams & { number: string }; result: PullRequestDetail };
  "pull-files": { params: WorkspaceParams & { number: string }; result: PullRequestChanges };
  "pull-diff": {
    params: WorkspaceParams & { number: string; path: string };
    result: PullRequestComparison;
  };
  discussions: {
    params: WorkspaceParams & { state?: string; page?: string };
    result: DiscussionList;
  };
  discussion: { params: WorkspaceParams & { number: string }; result: DiscussionDetail };
  pipelines: {
    params: WorkspaceParams & { status?: string; page?: string };
    result: PipelineList;
  };
  pipeline: { params: WorkspaceParams & { id: string }; result: PipelineDetail };
  job: { params: WorkspaceParams & { id: string }; result: PipelineJobDetail };
  releases: { params: WorkspaceParams & { page?: string }; result: ReleaseList };
  release: { params: WorkspaceParams & { tag: string }; result: ReleaseDetail };
}
export type WorkspaceReadAction = keyof WorkspaceReadActions;
export type WorkspaceReadParams<K extends WorkspaceReadAction> = WorkspaceReadActions[K]["params"];
export type WorkspaceReadResult<K extends WorkspaceReadAction> = WorkspaceReadActions[K]["result"];

/** Which provider serves a read action; the table is the only place that knows the split. */
export const READ_ACTION_DOMAINS: Record<WorkspaceReadAction, WorkspaceReadDomain> = {
  root: "files",
  tree: "files",
  file: "files",
  info: "files",
  trash: "files",
  "trash-sizes": "files",
  external: "files",
  changes: "files",
  "compare-file": "files",
  paths: "files",
  git: "git",
  branches: "git",
  log: "git",
  commit: "git",
  "commit-diff": "git",
  gutter: "git",
  diff: "git",
  search: "search",
  issues: "issues",
  issue: "issues",
  pulls: "pulls",
  pull: "pulls",
  "pull-files": "pulls",
  "pull-diff": "pulls",
  discussions: "discussions",
  discussion: "discussions",
  pipelines: "pipelines",
  pipeline: "pipelines",
  job: "pipelines",
  releases: "releases",
  release: "releases",
};

/** Actions read through a file scope: `rev`/`from`/`to` are added by the scope, not the caller. */
export type WorkspaceScopeReadAction =
  | "tree"
  | "file"
  | "search"
  | "paths"
  | "changes"
  | "compare-file";

export interface WorkspaceScopeReadActions {
  tree: WorkspaceParams & { path?: string; offset?: string; limit?: string; reveal?: string };
  file: WorkspaceParams & { path: string; ask?: string };
  search: WorkspaceParams & { q: string; case?: string; word?: string; regex?: string };
  paths: WorkspaceParams & { q: string; limit?: string };
  changes: WorkspaceParams;
  "compare-file": WorkspaceParams & { path: string; originalPath?: string };
}
export type WorkspaceScopeReadParams<K extends WorkspaceScopeReadAction> =
  WorkspaceScopeReadActions[K];

/** Параметры можно не передавать, когда действию они не нужны. */
export type WorkspaceRequestArgs<K extends WorkspaceReadAction> =
  {} extends WorkspaceReadParams<K>
    ? [params?: WorkspaceReadParams<K>, signal?: AbortSignal]
    : [params: WorkspaceReadParams<K>, signal?: AbortSignal];
export type WorkspaceScopeRequestArgs<K extends WorkspaceScopeReadAction> =
  {} extends WorkspaceScopeReadParams<K>
    ? [params?: WorkspaceScopeReadParams<K>, signal?: AbortSignal]
    : [params: WorkspaceScopeReadParams<K>, signal?: AbortSignal];
