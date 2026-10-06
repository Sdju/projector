import { ref, type Ref } from "vue";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

export type TrackerState = "open" | "closed" | "all";

/**
 * Список сущностей проекта (issues, pull requests) с фильтром по состоянию: первая страница и
 * подгрузка следующих (страница — номер или курсор). `action` — действие провайдера, `key` — поле ответа со списком.
 */
export function usePagedList<T extends { number: number }>(
  projectId: () => string,
  action: string,
  key: string,
  failure: string,
) {
  const state = ref<TrackerState>("open");
  const items = ref<T[]>([]) as Ref<T[]>;
  const next = ref<number | string | null>(null);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref("");
  let generation = 0;
  const page = (cursor: number | string) =>
    workspaceRequest<Record<string, unknown>>(projectId(), action, {
      state: state.value,
      page: String(cursor),
    });
  const message = (err: unknown) => (err instanceof Error ? err.message : failure);
  async function load() {
    const current = ++generation;
    loading.value = true;
    loadingMore.value = false;
    error.value = "";
    try {
      const data = await page(1);
      if (current !== generation) return;
      items.value = data[key] as T[];
      next.value = data.next as number | string | null;
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
      items.value = [
        ...items.value,
        ...(data[key] as T[]).filter((item) => !known.has(item.number)),
      ];
      next.value = data.next as number | string | null;
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
