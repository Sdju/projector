import { ref } from "vue";
import type {
  PullRequest,
  PullRequestList,
} from "../../../../../../core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

export type PullState = "open" | "closed" | "all";

/** Список pull requests проекта: фильтр по состоянию, первая страница и подгрузка следующих. */
export function usePulls(projectId: () => string) {
  const state = ref<PullState>("open");
  const pulls = ref<PullRequest[]>([]);
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
      const data = await workspaceRequest<PullRequestList>(projectId(), "pulls", {
        state: state.value,
        page: "1",
      });
      if (current !== generation) return;
      pulls.value = data.pulls;
      next.value = data.next;
    } catch (err) {
      if (current === generation)
        error.value = err instanceof Error ? err.message : "Не удалось прочитать pull requests";
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  async function more() {
    if (next.value === null || loading.value || loadingMore.value) return;
    const current = generation;
    loadingMore.value = true;
    try {
      const data = await workspaceRequest<PullRequestList>(projectId(), "pulls", {
        state: state.value,
        page: String(next.value),
      });
      if (current !== generation) return;
      const known = new Set(pulls.value.map((pull) => pull.number));
      pulls.value = [...pulls.value, ...data.pulls.filter((pull) => !known.has(pull.number))];
      next.value = data.next;
    } catch (err) {
      if (current === generation)
        error.value = err instanceof Error ? err.message : "Не удалось прочитать pull requests";
    } finally {
      if (current === generation) loadingMore.value = false;
    }
  }
  /** Запоминает фильтр и читает первую страницу заново. */
  function filter(nextState: PullState) {
    state.value = nextState;
    pulls.value = [];
    next.value = null;
    return load();
  }
  function reset() {
    ++generation;
    state.value = "open";
    pulls.value = [];
    next.value = null;
    loading.value = false;
    loadingMore.value = false;
    error.value = "";
  }
  return { state, pulls, next, loading, loadingMore, error, load, more, filter, reset };
}
export type PullsState = ReturnType<typeof usePulls>;
