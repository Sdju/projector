import { HttpError } from "../http/index.ts";
import type {
  Issue,
  IssueDetail,
  IssueList,
  Reaction,
} from "@ai-projector/core/modules/workspace/index.ts";
import { gitlabReader } from "./api.ts";
import { nextPage, projectId } from "./browser.ts";
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

/** GitHub states are the API contract; GitLab calls the open state `opened`. */
const STATES: Record<string, string> = { open: "opened", closed: "closed", all: "all" };

interface ApiIssue {
  iid: number;
  title?: string;
  state?: string;
  author?: GitlabUser;
  assignees?: GitlabUser[];
  labels?: Array<GitlabLabel | string>;
  user_notes_count?: number;
  description?: string | null;
  web_url?: string;
  created_at?: string;
  updated_at?: string;
}

function issue(raw: ApiIssue, reactions: Reaction[] = []): Issue {
  return {
    number: raw.iid,
    title: raw.title || "",
    state: raw.state === "closed" ? "closed" : "open",
    author: gitlabUser(raw.author),
    labels: gitlabLabels(raw.labels),
    assignees: (raw.assignees ?? []).map(gitlabUser),
    // GitLab counts every note, including the system ones the detail view hides.
    comments: raw.user_notes_count ?? 0,
    body: raw.description || "",
    reactions,
    htmlUrl: raw.web_url || "",
    createdAt: raw.created_at || "",
    updatedAt: raw.updated_at || "",
  };
}

/** One page of the project issues, most recently updated first. */
export async function browseGitlabIssues(
  repository: string,
  params: Record<string, string> = {},
): Promise<IssueList> {
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
  const response = await reader.request<ApiIssue[]>(
    `/projects/${projectId(reader.target.path)}/issues?${query}`,
  );
  const rows = Array.isArray(response.data) ? response.data : [];
  // The list endpoint carries no award emoji: reactions stay empty instead of one request per issue.
  return {
    issues: rows.map((row) => issue(row)),
    next: nextPage(response.headers, page, rows.length, TRACKER_PAGE),
  };
}

/** Issue description, metadata and every non-system note up to the bounded number of pages. */
export async function browseGitlabIssue(repository: string, number: number): Promise<IssueDetail> {
  if (!Number.isInteger(number) || number <= 0) throw new HttpError(400, "Укажите номер issue");
  const reader = await gitlabReader(repository);
  const id = projectId(reader.target.path);
  const [raw, awards] = await Promise.all([
    reader.get<ApiIssue>(`/projects/${id}/issues/${number}`),
    optional(reader.get<GitlabAward[]>(`/projects/${id}/issues/${number}/award_emoji`), []),
  ]);
  const { comments, truncated } = await gitlabNotes(
    reader,
    `/projects/${id}/issues/${number}/notes`,
  );
  return {
    issue: issue(raw, awardReactions(awards)),
    comments,
    commentsTruncated: truncated,
  };
}
