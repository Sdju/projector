import type {
  GithubRepository,
  GithubEntry,
  GithubFile,
} from "@ai-projector/core/modules/github/index.ts";
import type {
  DiscussionDetail,
  DiscussionList,
  IssueDetail,
  IssueList,
  PipelineDetail,
  PipelineJobDetail,
  PipelineList,
  PullRequestDetail,
  PullRequestList,
  ReleaseDetail,
  ReleaseList,
} from "@ai-projector/core/modules/workspace/index.ts";
import { createBrowseReader, WorkspaceRequestError } from "../workspace-api/index.ts";
/** GitHub сообщает об ошибке тем же типом, что и остальные интеграции. */
export { WorkspaceRequestError as GithubRequestError };
export const readGit = createBrowseReader(
  "/api/integrations/github/browse",
  "Не удалось прочитать GitHub",
);
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
export const readPipelines = (
  repository: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) => readGit<PipelineList>("pipelines", { repository, ...params }, signal);
export const readPipeline = (repository: string, id: number, signal?: AbortSignal) =>
  readGit<PipelineDetail>("pipeline", { repository, id: String(id) }, signal);
export const readJob = (repository: string, id: number, signal?: AbortSignal) =>
  readGit<PipelineJobDetail>("job", { repository, id: String(id) }, signal);
export const readReleases = (
  repository: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) => readGit<ReleaseList>("releases", { repository, ...params }, signal);
export const readRelease = (repository: string, tag: string, signal?: AbortSignal) =>
  readGit<ReleaseDetail>("release", { repository, tag }, signal);
