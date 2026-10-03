import { onBeforeUnmount, ref } from "vue";
import { fetchDirectories } from "../../project/index.ts";
import type { DirectoryEntry } from "../../../../core/modules/directories/index.ts";

/** Directory suggestions with cancellation: a newer request invalidates any pending one. */
export function useDirectoryListing() {
  const entries = ref<DirectoryEntry[]>([]);
  const selected = ref(-1);
  const loading = ref(false);
  const error = ref("");
  const truncated = ref(false);
  let request: AbortController | undefined;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function invalidate() {
    clearTimeout(timer);
    ++generation;
    request?.abort();
    loading.value = false;
  }
  async function load(path: string, complete: boolean) {
    invalidate();
    const current = generation;
    request = new AbortController();
    loading.value = true;
    entries.value = [];
    selected.value = -1;
    error.value = "";
    truncated.value = false;
    try {
      const data = await fetchDirectories(path, complete, request.signal);
      if (current !== generation) return;
      entries.value = data.entries;
      truncated.value = data.truncated;
    } catch (err) {
      if (current === generation)
        error.value = err instanceof Error ? err.message : "Не удалось прочитать папку";
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  /** Typing: show the loading state at once, query after a short pause. */
  function schedule(path: string) {
    invalidate();
    entries.value = [];
    selected.value = -1;
    error.value = "";
    loading.value = true;
    timer = setTimeout(() => void load(path, true), 100);
  }
  onBeforeUnmount(invalidate);
  return { entries, selected, loading, error, truncated, invalidate, load, schedule };
}
