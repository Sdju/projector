import type {
  GitlabEntry,
  GitlabFile,
  GitlabRepository,
} from "../../../core/modules/gitlab/index.ts";
import type {
  IssueDetail,
  IssueList,
  PipelineDetail,
  PipelineJobDetail,
  PipelineList,
  PullRequestChanges,
  PullRequestComparison,
  PullRequestDetail,
  PullRequestList,
} from "../../../core/modules/workspace/index.ts";

export class GitlabRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Reads one GitLab browse action. `repository` is the canonical `<instance>/<path>` form the
 * server allowlists against the configured instance.
 */
export async function readGitlab<T>(
  action: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `/api/integrations/gitlab/browse/${action}?${new URLSearchParams(params)}`,
    { signal },
  );
  const data = await response.json();
  if (!response.ok)
    throw new GitlabRequestError(data.error || "Не удалось прочитать GitLab", response.status);
  return data;
}

export const readRepository = (repository: string, ref = "", signal?: AbortSignal) =>
  readGitlab<GitlabRepository>("repository", { repository, ref }, signal);
export const readTree = (repository: string, sha: string, path = "", signal?: AbortSignal) =>
  readGitlab<{ entries: GitlabEntry[]; truncated: boolean }>(
    "tree",
    { repository, sha, path },
    signal,
  );
export const readFile = (repository: string, sha: string, path: string, signal?: AbortSignal) =>
  readGitlab<GitlabFile>("file", { repository, sha, path }, signal);
export const searchSnapshots = (
  repository: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) =>
  readGitlab<{
    hits: import("../../../core/modules/workspace/index.ts").SearchHit[];
    truncated: boolean;
  }>("search", { repository, ...params }, signal);
/** History actions (`log`, `commit`, `commit-diff`); the server decides which parameters it needs. */
export function readGit<T = unknown>(
  action: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) {
  return readGitlab<T>(action, params, signal);
}
export const readIssues = (
  repository: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) => readGitlab<IssueList>("issues", { repository, ...params }, signal);
export const readIssue = (repository: string, number: number, signal?: AbortSignal) =>
  readGitlab<IssueDetail>("issue", { repository, number: String(number) }, signal);
export const readMergeRequests = (
  repository: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) => readGitlab<PullRequestList>("merge-requests", { repository, ...params }, signal);
export const readMergeRequest = (repository: string, number: number, signal?: AbortSignal) =>
  readGitlab<PullRequestDetail>("merge-request", { repository, number: String(number) }, signal);
export const readMergeRequestFiles = (repository: string, number: number, signal?: AbortSignal) =>
  readGitlab<PullRequestChanges>(
    "merge-request-files",
    { repository, number: String(number) },
    signal,
  );
export const readMergeRequestDiff = (
  repository: string,
  number: number,
  path: string,
  signal?: AbortSignal,
) =>
  readGitlab<PullRequestComparison>(
    "merge-request-diff",
    { repository, number: String(number), path },
    signal,
  );
export const readPipelines = (
  repository: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) => readGitlab<PipelineList>("pipelines", { repository, ...params }, signal);
export const readPipeline = (repository: string, id: number, signal?: AbortSignal) =>
  readGitlab<PipelineDetail>("pipeline", { repository, id: String(id) }, signal);
export const readJob = (repository: string, id: number, signal?: AbortSignal) =>
  readGitlab<PipelineJobDetail>("job", { repository, id: String(id) }, signal);
