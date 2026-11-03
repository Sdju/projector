import { ref, watch } from "vue";
import type { PullRequestComparison } from "../../../../../../core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

/** Раскрытые файлы merge request: стороны читаются при первом раскрытии и кешируются до смены head. */
export function usePullDiffs(projectId: () => string, number: () => number, head: () => string) {
  const expanded = ref(new Set<string>());
  /** Высота кода по файлам: переживает сворачивание и повторное раскрытие. */
  const heights = ref<Record<string, number>>({});
  const diffs = ref<
    Record<string, { loading: boolean; error: string; data?: PullRequestComparison }>
  >({});
  let generation = 0;
  async function load(path: string) {
    if (diffs.value[path]) return;
    const current = generation;
    diffs.value[path] = { loading: true, error: "" };
    try {
      const data = await workspaceRequest<PullRequestComparison>(projectId(), "pull-diff", {
        number: String(number()),
        path,
      });
      if (current === generation) diffs.value[path] = { loading: false, error: "", data };
    } catch (err) {
      if (current === generation)
        diffs.value[path] = {
          loading: false,
          error: err instanceof Error ? err.message : "Не удалось прочитать изменения",
        };
    }
  }
  async function toggle(path: string, value?: boolean) {
    const open = value ?? !expanded.value.has(path);
    if (!open) expanded.value.delete(path);
    else {
      expanded.value.add(path);
      await load(path);
    }
  }
  function reset() {
    generation++;
    expanded.value.clear();
    heights.value = {};
    diffs.value = {};
  }
  // A new push changes base/head: cached sides must not survive it.
  watch(head, reset);
  return { expanded, heights, diffs, toggle, reset };
}
