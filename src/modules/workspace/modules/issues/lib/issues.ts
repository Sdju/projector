import { ref } from "vue";
import type { Issue, IssueList } from "../../../../../../core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

export type IssueState = "open" | "closed" | "all";

/** Список issues проекта: фильтр по состоянию, первая страница и подгрузка следующих. */
export function useIssues(projectId: () => string) {
  const state = ref<IssueState>("open");
  const issues = ref<Issue[]>([]);
  const next = ref<number | null>(null);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref("");
  let generation = 0;
  async function load() {
    const current = ++generation;
    loading.value = true;
    loadingMore.value = false;
    error.value = "";
    try {
      const data = await workspaceRequest<IssueList>(projectId(), "issues", {
        state: state.value,
        page: "1",
      });
      if (current !== generation) return;
      issues.value = data.issues;
      next.value = data.next;
    } catch (err) {
      if (current === generation)
        error.value = err instanceof Error ? err.message : "Не удалось прочитать issues";
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  async function more() {
    if (next.value === null || loading.value || loadingMore.value) return;
    const current = generation;
    loadingMore.value = true;
    try {
      const data = await workspaceRequest<IssueList>(projectId(), "issues", {
        state: state.value,
        page: String(next.value),
      });
      if (current !== generation) return;
      const known = new Set(issues.value.map((issue) => issue.number));
      issues.value = [...issues.value, ...data.issues.filter((issue) => !known.has(issue.number))];
      next.value = data.next;
    } catch (err) {
      if (current === generation)
        error.value = err instanceof Error ? err.message : "Не удалось прочитать issues";
    } finally {
      if (current === generation) loadingMore.value = false;
    }
  }
  /** Запоминает фильтр и читает первую страницу заново. */
  function filter(nextState: IssueState) {
    state.value = nextState;
    issues.value = [];
    next.value = null;
    return load();
  }
  function reset() {
    ++generation;
    state.value = "open";
    issues.value = [];
    next.value = null;
    loading.value = false;
    loadingMore.value = false;
    error.value = "";
  }
  return { state, issues, next, loading, loadingMore, error, load, more, filter, reset };
}
export type IssuesState = ReturnType<typeof useIssues>;
