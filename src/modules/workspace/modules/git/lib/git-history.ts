import { ref } from "vue";
import type {
  GitCommit,
  GitCommitDetail,
  GitLog,
} from "../../../../../../core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

const PAGE = 50;
const emptyLog = (): GitLog => ({
  available: false,
  head: "",
  upstream: "",
  ahead: 0,
  behind: 0,
  me: "",
  commits: [],
  next: null,
});
export interface CommitDetailState {
  loading: boolean;
  error: string;
  detail?: GitCommitDetail;
}

/**
 * История Git проекта. Обновление перечитывает уже загруженный объём, а ответ
 * устаревшего запроса не перезаписывает свежий. Детали коммита неизменны, поэтому кэшируются по хешу.
 */
export function useGitHistory(projectId: () => string) {
  const log = ref<GitLog>(emptyLog());
  const commits = ref<GitCommit[]>([]);
  const query = ref("");
  const all = ref(false);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref("");
  const details = ref<Record<string, CommitDetailState>>({});
  let generation = 0;
  const params = (extra: Record<string, string>) => ({
    q: query.value,
    all: String(all.value),
    ...extra,
  });
  async function load() {
    const current = ++generation;
    loading.value = true;
    loadingMore.value = false;
    error.value = "";
    try {
      const limit = Math.min(200, Math.max(PAGE, commits.value.length));
      const data = await workspaceRequest<GitLog>(
        projectId(),
        "log",
        params({ limit: String(limit) }),
      );
      if (current !== generation) return;
      log.value = data;
      commits.value = data.commits;
    } catch (err) {
      if (current === generation) error.value = err instanceof Error ? err.message : "Ошибка Git";
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  async function more() {
    if (log.value.next === null || loading.value || loadingMore.value) return;
    const current = generation;
    loadingMore.value = true;
    try {
      const data = await workspaceRequest<GitLog>(
        projectId(),
        "log",
        params({ skip: String(log.value.next), limit: String(PAGE) }),
      );
      if (current !== generation) return;
      const known = new Set(commits.value.map((commit) => commit.hash));
      commits.value = [...commits.value, ...data.commits.filter((c) => !known.has(c.hash))];
      log.value = { ...log.value, next: data.next };
    } catch (err) {
      if (current === generation) error.value = err instanceof Error ? err.message : "Ошибка Git";
    } finally {
      if (current === generation) loadingMore.value = false;
    }
  }
  /** Запоминает фильтр и читает первую страницу заново. */
  function filter(next: { query?: string; all?: boolean }) {
    if (next.query !== undefined) query.value = next.query;
    if (next.all !== undefined) all.value = next.all;
    commits.value = [];
    return load();
  }
  async function detail(hash: string, force = false) {
    const existing = details.value[hash];
    if (existing && (existing.detail || existing.loading) && !force) return existing;
    const project = projectId();
    details.value[hash] = { loading: true, error: "" };
    try {
      const data = await workspaceRequest<GitCommitDetail>(project, "commit", { hash });
      if (project === projectId())
        details.value[hash] = { loading: false, error: "", detail: data };
    } catch (err) {
      if (project === projectId())
        details.value[hash] = {
          loading: false,
          error: err instanceof Error ? err.message : "Ошибка Git",
        };
    }
    return details.value[hash];
  }
  /** Сбрасывает историю при смене проекта и отменяет запросы прежнего. */
  function reset() {
    ++generation;
    log.value = emptyLog();
    commits.value = [];
    details.value = {};
    query.value = "";
    all.value = false;
    loading.value = false;
    loadingMore.value = false;
    error.value = "";
  }
  return {
    log,
    commits,
    query,
    all,
    loading,
    loadingMore,
    error,
    details,
    load,
    more,
    filter,
    detail,
    reset,
  };
}
export type GitHistoryState = ReturnType<typeof useGitHistory>;
