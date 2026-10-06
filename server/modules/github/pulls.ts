import { githubReader } from "./browser.ts";
import {
  COMMENT_PAGE,
  COMMENT_PAGES,
  comment,
  labels,
  reactions,
  user,
  type RemoteComment,
  type RemoteLabel,
  type RemoteReactions,
  type RemoteUser,
} from "./issues.ts";
import { HttpError } from "../http/index.ts";
import type {
  PullRequest,
  PullRequestDetail,
  PullRequestFile,
  PullRequestList,
  PullRequestReview,
} from "../../../core/modules/workspace/index.ts";

const PAGE = 30;
const FILE_PAGE = 100;
const FILE_PAGES = 3;
const STATES = ["open", "closed", "all"] as const;
const FILE_STATUSES: PullRequestFile["status"][] = [
  "added",
  "removed",
  "modified",
  "renamed",
  "copied",
  "changed",
  "unchanged",
];
const REVIEW_STATES: Record<string, PullRequestReview["state"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  DISMISSED: "dismissed",
  PENDING: "pending",
};

interface RemoteBranch {
  ref?: string;
  label?: string;
  repo?: { full_name?: string } | null;
}
interface RemotePull {
  number: number;
  title: string;
  state: string;
  draft?: boolean;
  merged_at?: string | null;
  user?: RemoteUser;
  labels?: Array<RemoteLabel | string>;
  head?: RemoteBranch;
  base?: RemoteBranch;
  body?: string | null;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  commits?: number;
  additions?: number;
  deletions?: number;
  changed_files?: number;
}
interface RemoteFile {
  filename: string;
  previous_filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
}
interface RemoteReview {
  id: number;
  user?: RemoteUser;
  state?: string;
  body?: string | null;
  html_url?: string;
  submitted_at?: string;
}

function pull(raw: RemotePull, reactionCounts?: RemoteReactions): PullRequest {
  return {
    number: raw.number,
    title: raw.title || "",
    state: raw.merged_at ? "merged" : raw.state === "closed" ? "closed" : "open",
    draft: !!raw.draft,
    author: user(raw.user),
    labels: labels(raw.labels),
    head: raw.head?.label || raw.head?.ref || "",
    base: raw.base?.ref || "",
    body: raw.body || "",
    reactions: reactions(reactionCounts),
    htmlUrl: raw.html_url || "",
    createdAt: raw.created_at || "",
    updatedAt: raw.updated_at || "",
  };
}
function file(raw: RemoteFile): PullRequestFile {
  return {
    path: raw.filename,
    previousPath: raw.previous_filename || "",
    status: FILE_STATUSES.includes(raw.status as PullRequestFile["status"])
      ? (raw.status as PullRequestFile["status"])
      : "changed",
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
  };
}
function review(raw: RemoteReview): PullRequestReview {
  return {
    id: raw.id,
    author: user(raw.user),
    state: REVIEW_STATES[raw.state ?? ""] ?? "commented",
    body: raw.body || "",
    htmlUrl: raw.html_url || "",
    submittedAt: raw.submitted_at || "",
  };
}

/** One page of the repository pull requests, most recently updated first. */
export async function browseGithubPulls(
  repository: string,
  params: Record<string, string> = {},
): Promise<PullRequestList> {
  const get = await githubReader(repository);
  const state = (STATES as readonly string[]).includes(params.state) ? params.state : "open";
  const page =
    Number.isInteger(Number(params.page)) && Number(params.page) > 0 ? Number(params.page) : 1;
  const raw = await get<RemotePull[]>(
    `/pulls?state=${state}&per_page=${PAGE}&page=${page}&sort=updated&direction=desc`,
  );
  return { pulls: raw.map((item) => pull(item)), next: raw.length === PAGE ? page + 1 : null };
}

/** Pull request metadata, conversation, reviews and changed files, each read up to a bound. */
export async function browseGithubPull(
  repository: string,
  number: number,
): Promise<PullRequestDetail> {
  if (!Number.isInteger(number) || number <= 0)
    throw new HttpError(400, "Укажите номер pull request");
  const get = await githubReader(repository);
  const [raw, issue, reviews] = await Promise.all([
    get<RemotePull>(`/pulls/${number}`),
    // Reactions of the description live on the issue side of a pull request.
    get<{ reactions?: RemoteReactions }>(`/issues/${number}`),
    get<RemoteReview[]>(`/pulls/${number}/reviews?per_page=100`),
  ]);
  const comments: PullRequestDetail["comments"] = [];
  let commentsTruncated = false;
  for (let page = 1; page <= COMMENT_PAGES; page++) {
    const batch = await get<RemoteComment[]>(
      `/issues/${number}/comments?per_page=${COMMENT_PAGE}&page=${page}`,
    );
    comments.push(...batch.map(comment));
    if (batch.length < COMMENT_PAGE) break;
    if (page === COMMENT_PAGES) commentsTruncated = true;
  }
  const files: PullRequestFile[] = [];
  for (let page = 1; page <= FILE_PAGES; page++) {
    const batch = await get<RemoteFile[]>(
      `/pulls/${number}/files?per_page=${FILE_PAGE}&page=${page}`,
    );
    files.push(...batch.map(file));
    if (batch.length < FILE_PAGE) break;
  }
  const changedFiles = raw.changed_files ?? files.length;
  return {
    pull: pull(raw, issue.reactions),
    commits: raw.commits ?? 0,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles,
    comments,
    // A review with no text and the plain "commented" state only wraps inline comments.
    reviews: reviews.map(review).filter((item) => item.body || item.state !== "commented"),
    files,
    commentsTruncated,
    filesTruncated: files.length < changedFiles,
  };
}
