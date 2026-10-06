import type { Issue } from "../../../../../../core/modules/workspace/index.ts";
import { usePagedList, type TrackerState } from "./paged-list.ts";

export type IssueState = TrackerState;

/** Список issues проекта. */
export const useIssues = (projectId: () => string) =>
  usePagedList<Issue>(projectId, "issues", "issues", "Не удалось прочитать issues");
export type IssuesState = ReturnType<typeof useIssues>;
