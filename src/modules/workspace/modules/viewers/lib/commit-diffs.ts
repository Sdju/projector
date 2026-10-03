import { ref } from "vue";
import type { CommitComparison } from "../../../../../../core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

/** Раскрытые файлы коммита: код читается при первом раскрытии и кэшируется до смены коммита. */
export function useCommitDiffs(projectId: () => string, hash: () => string) {
  const expanded = ref(new Set<string>());
  /** Высота кода по файлам: переживает сворачивание и повторное раскрытие. */
  const heights = ref<Record<string, number>>({});
  const diffs = ref<Record<string, { loading: boolean; error: string; data?: CommitComparison }>>(
    {},
  );
  let generation = 0;
  async function loadDiff(path: string) {
    if (diffs.value[path]) return;
    const current = generation;
    diffs.value[path] = { loading: true, error: "" };
    try {
      const data = await workspaceRequest<CommitComparison>(projectId(), "commit-diff", {
        hash: hash(),
        path,
      });
      if (current === generation) diffs.value[path] = { loading: false, error: "", data };
    } catch (err) {
      if (current === generation)
        diffs.value[path] = {
          loading: false,
          error: err instanceof Error ? err.message : "Ошибка Git",
        };
    }
  }
  async function toggle(path: string, value?: boolean) {
    const open = value ?? !expanded.value.has(path);
    if (!open) expanded.value.delete(path);
    else {
      expanded.value.add(path);
      await loadDiff(path);
    }
  }
  function reset() {
    generation++;
    expanded.value.clear();
    heights.value = {};
    diffs.value = {};
  }
  return { expanded, heights, diffs, toggle, reset };
}
