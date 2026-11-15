import { usePagedList, type TrackerState } from "./paged-list.ts";

export type IssueState = TrackerState;

/** Список issues проекта. */
export const useIssues = (projectId: () => string) =>
  usePagedList(projectId, "issues", "Не удалось прочитать issues");
export type IssuesState = ReturnType<typeof useIssues>;
