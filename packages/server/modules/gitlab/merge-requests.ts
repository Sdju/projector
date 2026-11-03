import { HttpError } from "../http/index.ts";
import type {
  PullRequest,
  PullRequestApprovals,
  PullRequestChanges,
  PullRequestComparison,
  PullRequestDetail,
  PullRequestDiffRefs,
  PullRequestFile,
  PullRequestList,
  PullRequestState,
  PullRequestReview,
  Reaction,
} from "@projector/core/modules/workspace/index.ts";
import { gitlabReader, type GitlabReader } from "./api.ts";
import {
  DIFF_LIMIT,
  diffCounts,
  diffStatus,
  isBinaryDiff,
  nextPage,
  projectId,
  readGitlabFileAt,
  safePath,
  type ApiDiff,
} from "./browser.ts";
import { pipeline, type ApiPipeline } from "./pipelines.ts";
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
  reviewers?: GitlabUser[];
  labels?: Array<GitlabLabel | string>;
  description?: string | null;
  web_url?: string;
  created_at?: string;
  updated_at?: string;
  source_branch?: string;
  target_branch?: string;
  sha?: string;
  changes_count?: string | number;
  commits_count?: number;
  detailed_merge_status?: string;
  has_conflicts?: boolean;
  blocking_discussions_resolved?: boolean;
  user_notes_count?: number;
  source_project_id?: number;
  target_project_id?: number;
  diff_refs?: {
    base_sha?: string;
    start_sha?: string;
    head_sha?: string;
  } | null;
  head_pipeline?: ApiPipeline | null;
  pipeline?: ApiPipeline | null;
}
interface ApiApprovals {
  approved_by?: Array<{ user?: GitlabUser }>;
  approvals_required?: number;
  approvals_left?: number;
}

function pullState(raw: ApiMergeRequest): PullRequestState {
  if (raw.merged_at || raw.state === "merged") return "merged";
  if (raw.state === "closed") return "closed";
  return "open";
}

function pull(raw: ApiMergeRequest, reactions: Reaction[] = []): PullRequest {
  const source = raw.head_pipeline ?? raw.pipeline;
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
    ...(source ? { pipeline: pipeline(source) } : {}),
    ...(typeof raw.user_notes_count === "number" ? { comments: raw.user_notes_count } : {}),
    ...(raw.detailed_merge_status ? { mergeStatus: raw.detailed_merge_status } : {}),
    ...(raw.has_conflicts === true ? { hasConflicts: true } : {}),
    ...(raw.blocking_discussions_resolved === false ? { blockingDiscussionsResolved: false } : {}),
  };
}

function mergeRequestFile(raw: ApiDiff): PullRequestFile {
  const counts = raw.diff ? diffCounts(raw.diff) : { additions: 0, deletions: 0 };
  const binary = isBinaryDiff(raw);
  return {
    path: raw.new_path,
    previousPath: raw.old_path === raw.new_path ? "" : raw.old_path,
    status: FILE_STATUS[diffStatus(raw)] ?? "modified",
    additions: counts.additions,
    deletions: counts.deletions,
    ...(binary ? { binary: true } : {}),
    ...(raw.too_large === true ? { tooLarge: true } : {}),
    ...(raw.generated_file === true ? { generated: true } : {}),
  };
}

/** `changes_count` is a string and turns into `1000+` when GitLab caps a huge merge request. */
function changesCount(raw: ApiMergeRequest, loaded: number) {
  const value = raw.changes_count;
  if (value === undefined || value === "") return { changedFiles: loaded, capped: false };
  if (typeof value === "string" && value.endsWith("+")) {
    const capped = Number(value.slice(0, -1));
    return { changedFiles: Number.isFinite(capped) ? capped : loaded, capped: true };
  }
  const count = Number(value);
  return Number.isFinite(count)
    ? { changedFiles: count, capped: false }
    : { changedFiles: loaded, capped: false };
}

/** `diff_refs` is empty right after the merge request is created and populates asynchronously. */
function diffRefsOf(raw: ApiMergeRequest): PullRequestDiffRefs | undefined {
  const base = raw.diff_refs?.base_sha || "";
  const head = raw.diff_refs?.head_sha || "";
  if (!base || !head) return undefined;
  return { baseSha: base, startSha: raw.diff_refs?.start_sha || base, headSha: head };
}

function approvalsOf(raw: ApiApprovals): PullRequestApprovals {
  const approvedBy = (raw.approved_by ?? []).flatMap((entry) =>
    entry.user ? [gitlabUser(entry.user)] : [],
  );
  const required = Number(raw.approvals_required);
  const left = Number(raw.approvals_left);
  return {
    approvedBy,
    required: Number.isFinite(required) && required > 0 ? required : 0,
    left: Number.isFinite(left) && left >= 0 ? left : 0,
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

/** Files of one merge request with the pinned SHAs; the detail and the changes panel share this read. */
async function mergeRequestChanges(
  reader: GitlabReader,
  id: string,
  iid: number,
  raw: ApiMergeRequest,
): Promise<PullRequestChanges> {
  const { files: diffs, truncated } = await mergeRequestDiffs(reader, id, iid);
  const files = diffs.map(mergeRequestFile);
  const { changedFiles, capped } = changesCount(raw, files.length);
  const refs = diffRefsOf(raw);
  return {
    files,
    changedFiles,
    changedFilesCapped: capped,
    filesTruncated: truncated || capped || changedFiles > files.length,
    ...(refs ? { diffRefs: refs } : {}),
  };
}

function mergeRequestNumber(number: number) {
  if (!Number.isInteger(number) || number <= 0)
    throw new HttpError(400, "Укажите номер merge request");
  return number;
}

/** Lightweight changed-file list for the sidebar tree: no conversation and approvals. */
export async function browseGitlabMergeRequestFiles(
  repository: string,
  number: number,
): Promise<PullRequestChanges> {
  const iid = mergeRequestNumber(number);
  const reader = await gitlabReader(repository);
  const id = projectId(reader.target.path);
  const raw = await reader.get<ApiMergeRequest>(`/projects/${id}/merge_requests/${iid}`);
  return mergeRequestChanges(reader, id, iid, raw);
}

/** Both readable sides of one changed file, pinned by the merge request diff refs. */
export async function browseGitlabMergeRequestDiff(
  repository: string,
  number: number,
  path: string,
): Promise<PullRequestComparison> {
  const iid = mergeRequestNumber(number);
  safePath(path);
  const reader = await gitlabReader(repository);
  const id = projectId(reader.target.path);
  const raw = await reader.get<ApiMergeRequest>(`/projects/${id}/merge_requests/${iid}`);
  const refs = diffRefsOf(raw);
  if (!refs)
    throw new HttpError(
      409,
      "GitLab ещё не подготовил diff merge request. Обновите карточку позже",
    );
  const { files: diffs } = await mergeRequestDiffs(reader, id, iid);
  const file = diffs.find((item) => item.new_path === path || item.old_path === path);
  if (!file) throw new HttpError(404, "Файл не входит в этот merge request");
  const headProject = raw.source_project_id ? String(raw.source_project_id) : id;
  const base = { hash: refs.headSha, parent: refs.baseSha.slice(0, 7) };
  if (file.too_large === true)
    return { path, original: "", modified: "", ...base, binary: false, tooLarge: true };
  if (isBinaryDiff(file))
    return { path, original: "", modified: "", ...base, binary: true, tooLarge: false };
  const read = async (project: string, ref: string, name: string) => {
    try {
      return await readGitlabFileAt(reader, project, ref, name);
    } catch (error) {
      if (error instanceof HttpError && error.status === 413) return undefined;
      throw error;
    }
  };
  const [originalSide, modifiedSide] = await Promise.all([
    file.new_file ? { content: "", binary: false } : read(id, refs.baseSha, file.old_path),
    file.deleted_file
      ? { content: "", binary: false }
      : read(headProject, refs.headSha, file.new_path),
  ]);
  if (!originalSide || !modifiedSide)
    return { path, original: "", modified: "", ...base, binary: false, tooLarge: true };
  if (originalSide.binary || modifiedSide.binary)
    return { path, original: "", modified: "", ...base, binary: true, tooLarge: false };
  return {
    path,
    original: originalSide.content,
    modified: modifiedSide.content,
    ...base,
    binary: false,
    tooLarge: false,
  };
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
  const iid = mergeRequestNumber(number);
  const reader = await gitlabReader(repository);
  const id = projectId(reader.target.path);
  const [raw, awards, approvals] = await Promise.all([
    reader.get<ApiMergeRequest>(`/projects/${id}/merge_requests/${iid}`),
    optional(reader.get<GitlabAward[]>(`/projects/${id}/merge_requests/${iid}/award_emoji`), []),
    optional(reader.get<ApiApprovals>(`/projects/${id}/merge_requests/${iid}/approvals`), {}),
  ]);
  const { comments, truncated } = await gitlabNotes(
    reader,
    `/projects/${id}/merge_requests/${iid}/notes`,
  );
  let commits = raw.commits_count ?? 0;
  if (raw.commits_count === undefined) {
    const response = await reader
      .request<unknown>(`/projects/${id}/merge_requests/${iid}/commits?per_page=1`)
      .catch(() => null);
    const total = Number(response?.headers.get("X-Total"));
    if (Number.isFinite(total)) commits = total;
  }
  const changes = await mergeRequestChanges(reader, id, iid, raw);
  return {
    pull: pull(raw, awardReactions(awards)),
    commits,
    additions: changes.files.reduce((sum, file) => sum + file.additions, 0),
    deletions: changes.files.reduce((sum, file) => sum + file.deletions, 0),
    changedFiles: changes.changedFiles,
    comments,
    reviews: approvedBy(approvals),
    reviewers: (raw.reviewers ?? []).map(gitlabUser),
    approvals: approvalsOf(approvals),
    pipeline: raw.head_pipeline
      ? pipeline(raw.head_pipeline)
      : raw.pipeline
        ? pipeline(raw.pipeline)
        : null,
    ...(changes.diffRefs ? { diffRefs: changes.diffRefs } : {}),
    ...(raw.source_project_id !== undefined ? { sourceProjectId: raw.source_project_id } : {}),
    ...(raw.detailed_merge_status ? { mergeStatus: raw.detailed_merge_status } : {}),
    ...(raw.has_conflicts === true ? { hasConflicts: true } : {}),
    ...(raw.blocking_discussions_resolved === false ? { blockingDiscussionsResolved: false } : {}),
    files: changes.files,
    commentsTruncated: truncated,
    filesTruncated: changes.filesTruncated,
    ...(changes.changedFilesCapped ? { changedFilesCapped: true } : {}),
  };
}
