import { ref, type Ref } from "vue";
import type { Pipeline, PipelineList } from "@ai-projector/core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

export type PipelineFilter = "all" | "running" | "success" | "failed" | "canceled";

export const PIPELINE_FILTERS: Array<{ value: PipelineFilter; label: string }> = [
  { value: "all", label: "все" },
  { value: "running", label: "идут" },
  { value: "failed", label: "ошибки" },
  { value: "success", label: "успех" },
];

/** Pipeline list with a status filter and numbered pages, newest first. */
export function usePipelines(projectId: () => string) {
  const status = ref<PipelineFilter>("all");
  const items = ref<Pipeline[]>([]) as Ref<Pipeline[]>;
  const next = ref<number | null>(null);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref("");
  let generation = 0;
  const page = (cursor: number) =>
    workspaceRequest<PipelineList>(projectId(), "pipelines", {
      status: status.value,
      page: String(cursor),
    });
  const message = (err: unknown) =>
    err instanceof Error ? err.message : "Не удалось прочитать pipelines";
  async function load() {
    const current = ++generation;
    loading.value = true;
    loadingMore.value = false;
    error.value = "";
    try {
      const data = await page(1);
      if (current !== generation) return;
      items.value = data.pipelines;
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
      const known = new Set(items.value.map((item) => item.id));
      items.value = [...items.value, ...data.pipelines.filter((item) => !known.has(item.id))];
      next.value = data.next;
    } catch (err) {
      if (current === generation) error.value = message(err);
    } finally {
      if (current === generation) loadingMore.value = false;
    }
  }
  function filter(value: PipelineFilter) {
    status.value = value;
    items.value = [];
    next.value = null;
    return load();
  }
  function reset() {
    ++generation;
    status.value = "all";
    items.value = [];
    next.value = null;
    loading.value = false;
    loadingMore.value = false;
    error.value = "";
  }
  return { status, items, next, loading, loadingMore, error, load, more, filter, reset };
}
