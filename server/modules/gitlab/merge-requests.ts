import { HttpError } from "../http/index.ts";
import type {
  PullRequest,
  PullRequestDetail,
  PullRequestFile,
  PullRequestList,
  PullRequestState,
  PullRequestReview,
  Reaction,
} from "../../../core/modules/workspace/index.ts";
import { gitlabReader, type GitlabReader } from "./api.ts";
import {
  DIFF_LIMIT,
  diffCounts,
  diffStatus,
  nextPage,
  projectId,
  type ApiDiff,
} from "./browser.ts";
import {
  awardReactions,
  gitlabLabels,
  gitlabNotes,
  gitlabUser,
  optional,
  TRACKER_PAGE,
  trackerPage,
  type GitlabAward,
  type GitlabLabel,
  type GitlabUser,
} from "./trackers.ts";

/** GitHub states are the API contract; GitLab calls the open state `opened` and has `merged`. */
const STATES: Record<string, string> = {
  open: "opened",
  closed: "closed",
  merged: "merged",
  all: "all",
};
const FILE_PAGE = 100;
const DRAFT_TITLE = /^\s*(draft|wip)\s*:/i;
const FILE_STATUS: Record<string, PullRequestFile["status"]> = {
  A: "added",
  D: "removed",
  R: "renamed",
  C: "copied",
  T: "modified",
  M: "modified",
};

interface ApiMergeRequest {
  iid: number;
  title?: string;
  state?: string;
  draft?: boolean;
  /** Older GitLab versions used this flag instead of `draft`. */
  work_in_progress?: boolean;
  merged_at?: string | null;
  author?: GitlabUser;
  labels?: Array<GitlabLabel | string>;
  description?: string | null;
  web_url?: string;
  created_at?: string;
  updated_at?: string;
  source_branch?: string;
  target_branch?: string;
  changes_count?: string | number;
  commits_count?: number;
}
interface ApiApprovals {
  approved_by?: Array<{ user?: GitlabUser }>;
}

function pullState(raw: ApiMergeRequest): PullRequestState {
  if (raw.merged_at || raw.state === "merged") return "merged";
  if (raw.state === "closed") return "closed";
  return "open";
}

function pull(raw: ApiMergeRequest, reactions: Reaction[] = []): PullRequest {
  return {
    number: raw.iid,
    title: raw.title || "",
    state: pullState(raw),
    draft: raw.draft === true || raw.work_in_progress === true || DRAFT_TITLE.test(raw.title || ""),
    author: gitlabUser(raw.author),
    labels: gitlabLabels(raw.labels),
    head: raw.source_branch || "",
    base: raw.target_branch || "",
    body: raw.description || "",
    reactions,
    htmlUrl: raw.web_url || "",
    createdAt: raw.created_at || "",
    updatedAt: raw.updated_at || "",
  };
}

function mergeRequestFile(raw: ApiDiff): PullRequestFile {
  const counts = raw.diff ? diffCounts(raw.diff) : { additions: 0, deletions: 0 };
  return {
    path: raw.new_path,
    previousPath: raw.old_path === raw.new_path ? "" : raw.old_path,
    status: FILE_STATUS[diffStatus(raw)] ?? "modified",
    additions: counts.additions,
    deletions: counts.deletions,
  };
}

function approvedBy(raw: ApiApprovals): PullRequestReview[] {
  return (raw.approved_by ?? []).flatMap((entry) =>
    entry.user
      ? [
          {
            id: entry.user.id ?? 0,
            author: gitlabUser(entry.user),
            // Approvals are the only review state this endpoint exposes; resubmissions are not.
            state: "approved" as const,
            body: "",
            htmlUrl: "",
            submittedAt: "",
          },
        ]
      : [],
  );
}

/** `/changes` is the pre-16 fallback of `/diffs`: one unpaginated array, still capped at the limit. */
async function changesFallback(reader: GitlabReader, id: string, iid: number) {
  const data = await reader.get<{ changes?: ApiDiff[] }>(
    `/projects/${id}/merge_requests/${iid}/changes`,
  );
  const rows = Array.isArray(data.changes) ? data.changes : [];
  return { files: rows.slice(0, DIFF_LIMIT), truncated: rows.length > DIFF_LIMIT };
}

async function mergeRequestDiffs(reader: GitlabReader, id: string, iid: number) {
  const files: ApiDiff[] = [];
  for (let fetched = 0; fetched < DIFF_LIMIT / FILE_PAGE; fetched++) {
    const page = fetched + 1;
    let rows: ApiDiff[];
    try {
      const response = await reader.request<ApiDiff[]>(
        `/projects/${id}/merge_requests/${iid}/diffs?per_page=${FILE_PAGE}&page=${page}`,
      );
      rows = Array.isArray(response.data) ? response.data : [];
      files.push(...rows);
      const next = nextPage(response.headers, page, rows.length, FILE_PAGE);
      if (!next) return { files, truncated: files.length > DIFF_LIMIT };
      if (fetched === DIFF_LIMIT / FILE_PAGE - 1) return { files, truncated: true };
    } catch (error) {
      // Instances older than 16.0 have no `/diffs`; the whole diff comes from `/changes`.
      if (page === 1 && error instanceof HttpError && error.status === 404)
        return await changesFallback(reader, id, iid);
      throw error;
    }
  }
  return { files, truncated: true };
}

/** One page of the project merge requests, most recently updated first. */
export async function browseGitlabMergeRequests(
  repository: string,
  params: Record<string, string> = {},
): Promise<PullRequestList> {
  const state = STATES[params.state ?? ""] ?? "opened";
  const page = trackerPage(params.page);
  const reader = await gitlabReader(repository);
  const query = new URLSearchParams({
    state,
    per_page: String(TRACKER_PAGE),
    page: String(page),
    order_by: "updated_at",
    sort: "desc",
    with_labels_details: "true",
  });
  const response = await reader.request<ApiMergeRequest[]>(
    `/projects/${projectId(reader.target.path)}/merge_requests?${query}`,
  );
  const rows = Array.isArray(response.data) ? response.data : [];
  // The list endpoint carries no award emoji: reactions stay empty instead of one request per MR.
  return {
    pulls: rows.map((row) => pull(row)),
    next: nextPage(response.headers, page, rows.length, TRACKER_PAGE),
  };
}

/** Merge request description, conversation, approvals and changed files, each read up to a bound. */
export async function browseGitlabMergeRequest(
  repository: string,
  number: number,
): Promise<PullRequestDetail> {
  if (!Number.isInteger(number) || number <= 0)
    throw new HttpError(400, "Укажите номер merge request");
  const reader = await gitlabReader(repository);
  const id = projectId(reader.target.path);
  const [raw, awards, approvals] = await Promise.all([
    reader.get<ApiMergeRequest>(`/projects/${id}/merge_requests/${number}`),
    optional(reader.get<GitlabAward[]>(`/projects/${id}/merge_requests/${number}/award_emoji`), []),
    optional(reader.get<ApiApprovals>(`/projects/${id}/merge_requests/${number}/approvals`), {}),
  ]);
  const { comments, truncated } = await gitlabNotes(
    reader,
    `/projects/${id}/merge_requests/${number}/notes`,
  );
  let commits = raw.commits_count ?? 0;
  if (raw.commits_count === undefined) {
    const response = await reader
      .request<unknown>(`/projects/${id}/merge_requests/${number}/commits?per_page=1`)
      .catch(() => null);
    const total = Number(response?.headers.get("X-Total"));
    if (Number.isFinite(total)) commits = total;
  }
  const { files: diffs, truncated: filesTruncated } = await mergeRequestDiffs(reader, id, number);
  const files = diffs.map(mergeRequestFile);
  const reported = Number(raw.changes_count);
  const changedFiles =
    raw.changes_count !== undefined && raw.changes_count !== "" && Number.isFinite(reported)
      ? reported
      : files.length;
  return {
    pull: pull(raw, awardReactions(awards)),
    commits,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    changedFiles,
    comments,
    reviews: approvedBy(approvals),
    files,
    commentsTruncated: truncated,
    // `changes_count` counts every file of the MR; the diff pages may stop earlier.
    filesTruncated: filesTruncated || changedFiles > files.length,
  };
}
