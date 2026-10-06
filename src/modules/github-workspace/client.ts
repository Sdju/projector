import type {
  GithubRepository,
  GithubEntry,
  GithubFile,
} from "../../../core/modules/github/index.ts";
import type {
  DiscussionDetail,
  DiscussionList,
  IssueDetail,
  IssueList,
  PullRequestDetail,
  PullRequestList,
} from "../../../core/modules/workspace/index.ts";
export class GithubRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function readGit<T>(
  action: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `/api/integrations/github/browse/${action}?${new URLSearchParams(params)}`,
    { signal },
  );
  const data = await response.json();
  if (!response.ok)
    throw new GithubRequestError(data.error || "Не удалось прочитать GitHub", response.status);
  return data;
}
export const readRepository = (repository: string, ref = "", signal?: AbortSignal) =>
  readGit<GithubRepository>("repository", { repository, ref }, signal);
export const readTree = (repository: string, sha: string, signal?: AbortSignal) =>
  readGit<{ entries: GithubEntry[]; truncated: boolean }>("tree", { repository, sha }, signal);
export const readFile = (repository: string, sha: string, path: string, signal?: AbortSignal) =>
  readGit<GithubFile>("file", { repository, sha, path }, signal);
export const readIssues = (
  repository: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) => readGit<IssueList>("issues", { repository, ...params }, signal);
export const readIssue = (repository: string, number: number, signal?: AbortSignal) =>
  readGit<IssueDetail>("issue", { repository, number: String(number) }, signal);
export const readPulls = (
  repository: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) => readGit<PullRequestList>("pulls", { repository, ...params }, signal);
export const readPull = (repository: string, number: number, signal?: AbortSignal) =>
  readGit<PullRequestDetail>("pull", { repository, number: String(number) }, signal);
export const readDiscussions = (
  repository: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) => readGit<DiscussionList>("discussions", { repository, ...params }, signal);
export const readDiscussion = (repository: string, number: number, signal?: AbortSignal) =>
  readGit<DiscussionDetail>("discussion", { repository, number: String(number) }, signal);
