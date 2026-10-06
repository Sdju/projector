import { githubReader } from "./browser.ts";
import { HttpError } from "../http/index.ts";
import type {
  Issue,
  IssueComment,
  IssueDetail,
  IssueLabel,
  IssueList,
  IssueUser,
} from "../../../core/modules/workspace/index.ts";

const PAGE = 30;
const COMMENT_PAGE = 100;
const COMMENT_PAGES = 5;
const STATES = ["open", "closed", "all"] as const;

interface RemoteUser {
  login?: string;
  avatar_url?: string;
}
interface RemoteLabel {
  name?: string;
  color?: string;
}
interface RemoteIssue {
  number: number;
  title: string;
  state: string;
  user?: RemoteUser;
  labels?: Array<RemoteLabel | string>;
  assignees?: RemoteUser[];
  comments?: number;
  body?: string | null;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  /** Present only for pull requests, which the issues endpoint also returns. */
  pull_request?: unknown;
}
interface RemoteComment {
  id: number;
  user?: RemoteUser;
  body?: string | null;
  html_url?: string;
  created_at?: string;
}
function user(raw?: RemoteUser): IssueUser {
  return { login: raw?.login || "", avatarUrl: raw?.avatar_url || "" };
}
function labels(raw: RemoteIssue["labels"]): IssueLabel[] {
  return (raw ?? []).map((label) =>
    typeof label === "string"
      ? { name: label, color: "" }
      : { name: label.name || "", color: label.color || "" },
  );
}
function issue(raw: RemoteIssue): Issue {
  return {
    number: raw.number,
    title: raw.title || "",
    state: raw.state === "closed" ? "closed" : "open",
    author: user(raw.user),
    labels: labels(raw.labels),
    assignees: (raw.assignees ?? []).map(user),
    comments: raw.comments ?? 0,
    body: raw.body || "",
    htmlUrl: raw.html_url || "",
    createdAt: raw.created_at || "",
    updatedAt: raw.updated_at || "",
  };
}
function comment(raw: RemoteComment): IssueComment {
  return {
    id: raw.id,
    author: user(raw.user),
    body: raw.body || "",
    htmlUrl: raw.html_url || "",
    createdAt: raw.created_at || "",
  };
}

/** One page of the repository issues; pull requests are filtered out. */
export async function browseGithubIssues(
  repository: string,
  params: Record<string, string> = {},
): Promise<IssueList> {
  const get = await githubReader(repository);
  const state = (STATES as readonly string[]).includes(params.state) ? params.state : "open";
  const page =
    Number.isInteger(Number(params.page)) && Number(params.page) > 0 ? Number(params.page) : 1;
  const raw = await get<RemoteIssue[]>(
    `/issues?state=${state}&per_page=${PAGE}&page=${page}&sort=updated&direction=desc`,
  );
  const issues = raw.filter((item) => !item.pull_request).map(issue);
  return { issues, next: raw.length === PAGE ? page + 1 : null };
}

/** Issue body, metadata and every comment up to a bounded number of pages. */
export async function browseGithubIssue(repository: string, number: number): Promise<IssueDetail> {
  if (!Number.isInteger(number) || number <= 0) throw new HttpError(400, "Укажите номер issue");
  const get = await githubReader(repository);
  const raw = await get<RemoteIssue>(`/issues/${number}`);
  const comments: IssueComment[] = [];
  let commentsTruncated = false;
  for (let page = 1; page <= COMMENT_PAGES; page++) {
    const batch = await get<RemoteComment[]>(
      `/issues/${number}/comments?per_page=${COMMENT_PAGE}&page=${page}`,
    );
    comments.push(...batch.map(comment));
    if (batch.length < COMMENT_PAGE) break;
    if (page === COMMENT_PAGES) commentsTruncated = true;
  }
  return { issue: issue(raw), comments, commentsTruncated };
}
