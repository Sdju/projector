import { HttpError } from "../http/index.ts";
import type {
  IssueComment,
  IssueLabel,
  IssueUser,
  Reaction,
  ReactionKind,
} from "@ai-projector/core/modules/workspace/index.ts";
import type { GitlabReader } from "./api.ts";
import { nextPage } from "./browser.ts";

export const TRACKER_PAGE = 30;
export const NOTE_PAGE = 100;
export const NOTE_PAGES = 5;

const REACTION_ORDER: ReactionKind[] = [
  "+1",
  "-1",
  "laugh",
  "hooray",
  "confused",
  "heart",
  "rocket",
  "eyes",
];
/** GitLab award names are words, GitHub reaction names are the contract: `thumbsup` is `+1`. */
const AWARDS: Record<string, ReactionKind> = {
  thumbsup: "+1",
  thumbsdown: "-1",
  laughing: "laugh",
  hooray: "hooray",
  confused: "confused",
  heart: "heart",
  rocket: "rocket",
  eyes: "eyes",
};

export interface GitlabUser {
  id?: number;
  username?: string;
  avatar_url?: string;
}
export interface GitlabLabel {
  name?: string;
  color?: string;
}
export interface GitlabAward {
  name?: string;
  user?: GitlabUser;
}
export interface GitlabNote {
  id: number;
  system?: boolean;
  author?: GitlabUser;
  body?: string;
  created_at?: string;
}

export function gitlabUser(raw?: GitlabUser | null): IssueUser {
  return { login: raw?.username || "", avatarUrl: raw?.avatar_url || "" };
}

export function gitlabLabels(raw?: Array<GitlabLabel | string> | null): IssueLabel[] {
  return (raw ?? []).map((label) =>
    typeof label === "string"
      ? { name: label, color: "" }
      : { name: label.name || "", color: (label.color || "").replace(/^#/, "") },
  );
}

export function trackerPage(value?: string | number): number {
  const page = Number(value || 1);
  if (!Number.isSafeInteger(page) || page < 1) throw new HttpError(400, "Неверная страница");
  return page;
}

/** Awards arrive one row per voter, so equal names are counted into a single reaction. */
export function awardReactions(raw?: GitlabAward[] | null): Reaction[] {
  const counts = new Map<ReactionKind, number>();
  for (const award of raw ?? []) {
    const kind = AWARDS[award.name || ""];
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return REACTION_ORDER.flatMap((content) =>
    counts.has(content) ? [{ content, count: counts.get(content)! }] : [],
  );
}

/**
 * Reactions live on the award emoji endpoint only, so every mapped note keeps empty reactions:
 * loading them would cost one request per comment (N+1) on a page of up to 500 notes.
 */
export function gitlabComment(raw: GitlabNote): IssueComment {
  return {
    id: raw.id,
    author: gitlabUser(raw.author),
    body: raw.body || "",
    reactions: [],
    htmlUrl: "",
    createdAt: raw.created_at || "",
  };
}

/** Optional extras of a card (award emoji, approvals) are missing on old or unlicensed instances. */
export async function optional<T>(
  request: Promise<T>,
  fallback: T,
  statuses: number[] = [403, 404],
): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof HttpError && statuses.includes(error.status)) return fallback;
    throw error;
  }
}

/** Notes of an issue or merge request, oldest first, without `system: true` service records. */
export async function gitlabNotes(
  reader: GitlabReader,
  path: string,
): Promise<{ comments: IssueComment[]; truncated: boolean }> {
  const comments: IssueComment[] = [];
  for (let page = 1; page <= NOTE_PAGES; page++) {
    const query = new URLSearchParams({
      sort: "asc",
      order_by: "created_at",
      per_page: String(NOTE_PAGE),
      page: String(page),
    });
    const response = await reader.request<GitlabNote[]>(`${path}?${query}`);
    const rows = Array.isArray(response.data) ? response.data : [];
    comments.push(...rows.filter((note) => note.system !== true).map(gitlabComment));
    const next = nextPage(response.headers, page, rows.length, NOTE_PAGE);
    if (!next) return { comments, truncated: false };
    if (page === NOTE_PAGES) return { comments, truncated: true };
  }
  return { comments, truncated: false };
}
