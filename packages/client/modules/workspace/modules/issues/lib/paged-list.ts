import { ref, type Ref } from "vue";
import type { Discussion, Issue, PullRequest } from "@ai-projector/core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

export type TrackerState = "open" | "closed" | "all" | "merged";
export type TrackerListAction = "issues" | "pulls" | "discussions";
type TrackerListItem = Issue | PullRequest | Discussion;

/** Список сущностей проекта: фильтр по состоянию, первая страница и подгрузка следующих. */
export interface PagedList<T extends { number: number }> {
  state: Ref<TrackerState>;
  items: Ref<readonly T[]>;
  next: Ref<number | string | null>;
  loading: Ref<boolean>;
  loadingMore: Ref<boolean>;
  error: Ref<string>;
  load(): Promise<void>;
  more(): Promise<void>;
  filter(state: TrackerState): Promise<void>;
  reset(): void;
}

/**
 * Список сущностей проекта (issues, pull requests) с фильтром по состоянию: первая страница и
 * подгрузка следующих (страница — номер или курсор). `action` — действие провайдера, поле
 * ответа со списком названо так же.
 */
export function usePagedList(
  projectId: () => string,
  action: "issues",
  failure: string,
): PagedList<Issue>;
export function usePagedList(
  projectId: () => string,
  action: "pulls",
  failure: string,
): PagedList<PullRequest>;
export function usePagedList(
  projectId: () => string,
  action: "discussions",
  failure: string,
): PagedList<Discussion>;
export function usePagedList(
  projectId: () => string,
  action: TrackerListAction,
  failure: string,
): PagedList<TrackerListItem> {
  const state = ref<TrackerState>("open");
  const items = ref<readonly TrackerListItem[]>([]) as Ref<readonly TrackerListItem[]>;
  const next = ref<number | string | null>(null);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref("");
  let generation = 0;
  const page = async (cursor: number | string) => {
    const params = { state: state.value, page: String(cursor) };
    if (action === "issues") {
      const data = await workspaceRequest(projectId(), "issues", params);
      return { items: data.issues, next: data.next };
    }
    if (action === "pulls") {
      const data = await workspaceRequest(projectId(), "pulls", params);
      return { items: data.pulls, next: data.next };
    }
    const data = await workspaceRequest(projectId(), "discussions", params);
    return { items: data.discussions, next: data.next };
  };
  const message = (err: unknown) => (err instanceof Error ? err.message : failure);
  async function load() {
    const current = ++generation;
    loading.value = true;
    loadingMore.value = false;
    error.value = "";
    try {
      const data = await page(1);
      if (current !== generation) return;
      items.value = data.items;
      next.value = data.next;
    } catch (err) {
      if (current === generation) error.value = message(err);
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  async function more() {
    if (next.value === null || loading.value || loadingMore.value) return;
    const current = generation;
    loadingMore.value = true;
    try {
      const data = await page(next.value);
      if (current !== generation) return;
      const known = new Set(items.value.map((item) => item.number));
      const incoming: readonly TrackerListItem[] = data.items;
      items.value = [...items.value, ...incoming.filter((item) => !known.has(item.number))];
      next.value = data.next;
    } catch (err) {
      if (current === generation) error.value = message(err);
    } finally {
      if (current === generation) loadingMore.value = false;
    }
  }
  /** Запоминает фильтр и читает первую страницу заново. */
  function filter(nextState: TrackerState) {
    state.value = nextState;
    items.value = [];
    next.value = null;
    return load();
  }
  function reset() {
    ++generation;
    state.value = "open";
    items.value = [];
    next.value = null;
    loading.value = false;
    loadingMore.value = false;
    error.value = "";
  }
  return { state, items, next, loading, loadingMore, error, load, more, filter, reset };
}
