import { ref, watch } from "vue";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

export interface FileDiffState<T> {
  loading: boolean;
  error: string;
  data?: T;
}

/**
 * Expanded files of a commit or merge request: the code is read on first expansion and cached
 * until the source changes. `resetOn` drops cached sides when the source revision moves.
 */
export function useFileDiffs<T>(options: {
  projectId: () => string;
  action: string;
  params: () => Record<string, string>;
  errorFallback: string;
  resetOn?: () => unknown;
}) {
  const expanded = ref(new Set<string>());
  /** Code height per file: survives collapsing and expanding again. */
  const heights = ref<Record<string, number>>({});
  const diffs = ref<Record<string, FileDiffState<T>>>({});
  let generation = 0;

  async function load(path: string) {
    if (diffs.value[path]) return;
    const current = generation;
    diffs.value[path] = { loading: true, error: "" };
    try {
      const data = await workspaceRequest<T>(options.projectId(), options.action, {
        ...options.params(),
        path,
      });
      if (current === generation) diffs.value[path] = { loading: false, error: "", data };
    } catch (err) {
      if (current === generation)
        diffs.value[path] = {
          loading: false,
          error: err instanceof Error ? err.message : options.errorFallback,
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

  if (options.resetOn) watch(options.resetOn, reset);

  return { expanded, heights, diffs, toggle, reset };
}
