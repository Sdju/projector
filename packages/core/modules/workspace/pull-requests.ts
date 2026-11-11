import type {
  CommitComparison,
  IssueComment,
  IssueLabel,
  IssueUser,
  Reaction,
} from "./contract.ts";
import type { Pipeline } from "./pipelines.ts";

export type PullRequestState = "open" | "closed" | "merged";
export interface PullRequest {
  number: number;
  title: string;
  /** `merged` is a closed pull request that landed (`merged_at` set). */
  state: PullRequestState;
  draft: boolean;
  author: IssueUser;
  labels: IssueLabel[];
  /** Source branch; `owner:branch` for a fork. */
  head: string;
  base: string;
  body: string;
  reactions: Reaction[];
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  /** Latest pipeline of the source branch, when the host exposes it in the list. */
  pipeline?: Pipeline | null;
  /** Number of user comments reported by the host. */
  comments?: number;
  /** Host-specific merge readiness; GitLab reports `detailed_merge_status`. */
  mergeStatus?: string;
  hasConflicts?: boolean;
  blockingDiscussionsResolved?: boolean;
}
export interface PullRequestList {
  pulls: PullRequest[];
  /** Page number of the next page, or null when the list is complete. */
  next: number | null;
}
export interface PullRequestFile {
  path: string;
  /** Previous path of a renamed file. */
  previousPath: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  /** The host reports a binary diff or no text hunk. */
  binary?: boolean;
  /** GitLab excludes the diff because the file is too large. */
  tooLarge?: boolean;
  /** The host marks the file as generated. */
  generated?: boolean;
}
export interface PullRequestReview {
  id: number;
  author: IssueUser;
  state: "approved" | "changes_requested" | "commented" | "dismissed" | "pending";
  body: string;
  htmlUrl: string;
  submittedAt: string;
}
/** Approval state of a merge request; hosts without an approvals API leave it empty. */
export interface PullRequestApprovals {
  approvedBy: IssueUser[];
  /** Number of approvals the host requires; 0 when it does not report a quota. */
  required: number;
  left: number;
}
export interface PullRequestDetail {
  pull: PullRequest;
  commits: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** Conversation comments (not inline review comments). */
  comments: IssueComment[];
  reviews: PullRequestReview[];
  files: PullRequestFile[];
  /** Reviewers invited to the review, with their current state in `reviews`. */
  reviewers?: IssueUser[];
  /** Host-specific approval quota of a merge request. */
  approvals?: PullRequestApprovals;
  /** Latest pipeline of the source branch, when the host exposes one. */
  pipeline?: Pipeline | null;
  /** Pinned SHAs of the current merge request diff. */
  diffRefs?: PullRequestDiffRefs;
  /** Project that owns the source branch; differs from the target project for forks. */
  sourceProjectId?: number;
  /** Host-specific merge readiness; GitLab reports `detailed_merge_status`. */
  mergeStatus?: string;
  hasConflicts?: boolean;
  blockingDiscussionsResolved?: boolean;
  /** The host returned more comments or files than the reader loads at once. */
  commentsTruncated: boolean;
  filesTruncated: boolean;
  /** `changes_count` was capped by the host, so the exact file count is unknown. */
  changedFilesCapped?: boolean;
}

/** SHAs that pin a merge request diff: merge base, target head and source head. */
export interface PullRequestDiffRefs {
  baseSha: string;
  startSha: string;
  headSha: string;
}

/** Files of a merge request without the conversation payload; used by the changes panel. */
export interface PullRequestChanges {
  files: PullRequestFile[];
  changedFiles: number;
  changedFilesCapped: boolean;
  filesTruncated: boolean;
  /** Missing while GitLab has not prepared the diff yet. */
  diffRefs?: PullRequestDiffRefs;
}

/** Two readable sides of one changed file, in the same shape as a commit comparison. */
export interface PullRequestComparison extends CommitComparison {
  binary: boolean;
  tooLarge: boolean;
}
