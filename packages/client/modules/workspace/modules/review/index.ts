export { default as ReviewTab } from "./ui/ReviewTab.vue";
export {
  createReviewSession,
  matchesReviewSide,
  useReviewSession,
  reviewSessionKey,
} from "./lib/review-session.ts";
export type { ReviewComment, ReviewRange, ReviewSession } from "./lib/review-session.ts";
export { registerReviewCommands } from "./lib/review-commands.ts";
export { connectReviewWorkspace } from "./lib/review-workspace.ts";
export {
  formatCommentCount,
  formatFileCount,
  formatLineLabel,
  formatLineRange,
  formatReviewMessage,
  reviewChips,
} from "./lib/review-message.ts";
