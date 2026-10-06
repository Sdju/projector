import { githubGraphqlReader } from "./browser.ts";
import { HttpError } from "../http/index.ts";
import type {
  Discussion,
  DiscussionComment,
  DiscussionDetail,
  DiscussionList,
  IssueUser,
  Reaction,
  ReactionKind,
} from "../../../core/modules/workspace/index.ts";

const PAGE = 30;
const COMMENT_PAGE = 50;
const COMMENT_PAGES = 5;
const STATES: Record<string, string[] | null> = { open: ["OPEN"], closed: ["CLOSED"], all: null };
const CURSOR = /^[A-Za-z0-9+/=_-]{1,200}$/;

const GROUPS: Record<string, ReactionKind> = {
  THUMBS_UP: "+1",
  THUMBS_DOWN: "-1",
  LAUGH: "laugh",
  HOORAY: "hooray",
  CONFUSED: "confused",
  HEART: "heart",
  ROCKET: "rocket",
  EYES: "eyes",
};
interface RemoteReactionGroups {
  reactionGroups?: Array<{ content: string; reactors?: { totalCount?: number } }> | null;
}
function reactions(raw: RemoteReactionGroups): Reaction[] {
  return (raw.reactionGroups ?? []).flatMap((group) => {
    const content = GROUPS[group.content];
    const count = group.reactors?.totalCount ?? 0;
    return content && count ? [{ content, count }] : [];
  });
}
interface RemoteUser {
  login?: string;
  avatarUrl?: string;
}
interface RemoteDiscussion extends RemoteReactionGroups {
  number: number;
  title: string;
  closed?: boolean;
  isAnswered?: boolean | null;
  author?: RemoteUser | null;
  category?: { name?: string; emoji?: string } | null;
  labels?: { nodes?: Array<{ name?: string; color?: string } | null> } | null;
  comments?: { totalCount?: number } & { nodes?: RemoteComment[]; pageInfo?: PageInfo };
  upvoteCount?: number;
  body?: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
}
interface RemoteComment extends RemoteReactionGroups {
  databaseId?: number;
  author?: RemoteUser | null;
  body?: string;
  url?: string;
  createdAt?: string;
  upvoteCount?: number;
  isAnswer?: boolean;
  replies?: { totalCount?: number; nodes?: RemoteComment[] };
}
interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

const DISCUSSION_FIELDS = `
  number title closed isAnswered upvoteCount body url createdAt updatedAt
  author { login avatarUrl }
  reactionGroups { content reactors { totalCount } }
  category { name emoji }
  labels(first: 10) { nodes { name color } }
  comments { totalCount }
`;
const COMMENT_FIELDS = `
  databaseId body url createdAt upvoteCount
  author { login avatarUrl }
  reactionGroups { content reactors { totalCount } }
`;

function user(raw?: RemoteUser | null): IssueUser {
  // A deleted account comes back as null; GitHub itself shows it as "ghost".
  return { login: raw?.login || "ghost", avatarUrl: raw?.avatarUrl || "" };
}
function discussion(raw: RemoteDiscussion): Discussion {
  return {
    number: raw.number,
    title: raw.title || "",
    closed: !!raw.closed,
    answered: !!raw.isAnswered,
    author: user(raw.author),
    category: { name: raw.category?.name || "", emoji: raw.category?.emoji || "" },
    labels: (raw.labels?.nodes ?? []).flatMap((label) =>
      label ? [{ name: label.name || "", color: label.color || "" }] : [],
    ),
    comments: raw.comments?.totalCount ?? 0,
    upvotes: raw.upvoteCount ?? 0,
    body: raw.body || "",
    reactions: reactions(raw),
    htmlUrl: raw.url || "",
    createdAt: raw.createdAt || "",
    updatedAt: raw.updatedAt || "",
  };
}
function comment(raw: RemoteComment): DiscussionComment {
  const replies = raw.replies?.nodes ?? [];
  return {
    id: raw.databaseId ?? 0,
    author: user(raw.author),
    body: raw.body || "",
    reactions: reactions(raw),
    htmlUrl: raw.url || "",
    createdAt: raw.createdAt || "",
    upvotes: raw.upvoteCount ?? 0,
    isAnswer: !!raw.isAnswer,
    replies: replies.map((reply) => ({
      ...comment(reply),
      replies: [],
      repliesTruncated: false,
    })),
    repliesTruncated: (raw.replies?.totalCount ?? replies.length) > replies.length,
  };
}

/** One page of the repository discussions, most recently updated first; paged by cursor. */
export async function browseGithubDiscussions(
  repository: string,
  params: Record<string, string> = {},
): Promise<DiscussionList> {
  const query = await githubGraphqlReader(repository);
  const states = STATES[params.state] ?? null;
  // The first page has no cursor; the client sends "1" for it like it does for numbered pages.
  const after = params.page && CURSOR.test(params.page) && params.page !== "1" ? params.page : null;
  const data = await query<{
    repository: {
      hasDiscussionsEnabled: boolean;
      discussions: { nodes: RemoteDiscussion[]; pageInfo: PageInfo };
    } | null;
  }>(
    `query($owner: String!, $name: String!, $first: Int!, $after: String, $states: [DiscussionState!]) {
      repository(owner: $owner, name: $name) {
        hasDiscussionsEnabled
        discussions(first: $first, after: $after, states: $states, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes { ${DISCUSSION_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
    { first: PAGE, after, states },
  );
  if (!data.repository) throw new HttpError(404, "Репозиторий не найден или нет доступа");
  if (!data.repository.hasDiscussionsEnabled)
    throw new HttpError(404, "В репозитории выключены Discussions");
  const { nodes, pageInfo } = data.repository.discussions;
  return {
    discussions: nodes.map(discussion),
    next: pageInfo.hasNextPage ? pageInfo.endCursor : null,
  };
}

/** Discussion body and its comments with replies, up to a bounded number of pages. */
export async function browseGithubDiscussion(
  repository: string,
  number: number,
): Promise<DiscussionDetail> {
  if (!Number.isInteger(number) || number <= 0)
    throw new HttpError(400, "Укажите номер обсуждения");
  const query = await githubGraphqlReader(repository);
  const comments: DiscussionComment[] = [];
  let head: Discussion | undefined;
  let after: string | null = null;
  let commentsTruncated = false;
  for (let page = 1; page <= COMMENT_PAGES; page++) {
    const data: {
      repository: {
        discussion:
          | (RemoteDiscussion & { comments: { nodes: RemoteComment[]; pageInfo: PageInfo } })
          | null;
      } | null;
    } = await query(
      `query($owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String) {
        repository(owner: $owner, name: $name) {
          discussion(number: $number) {
            ${DISCUSSION_FIELDS.replace("comments { totalCount }", "")}
            comments(first: $first, after: $after) {
              totalCount
              pageInfo { hasNextPage endCursor }
              nodes {
                ${COMMENT_FIELDS} isAnswer
                replies(first: 50) { totalCount nodes { ${COMMENT_FIELDS} } }
              }
            }
          }
        }
      }`,
      { number, first: COMMENT_PAGE, after },
    );
    const raw = data.repository?.discussion;
    if (!raw) throw new HttpError(404, "Обсуждение не найдено или нет доступа");
    head ??= discussion(raw);
    comments.push(...raw.comments.nodes.map(comment));
    if (!raw.comments.pageInfo.hasNextPage) break;
    after = raw.comments.pageInfo.endCursor;
    if (page === COMMENT_PAGES) commentsTruncated = true;
  }
  return { discussion: head!, comments, commentsTruncated };
}
