import { ref, watch, type Ref } from "vue";

/**
 * Runs an async source and keeps the latest result. A stale response never replaces a newer one;
 * `enabled` can turn the source off while a caller supplies its own snapshot.
 */
export function useAsyncData<T>(options: {
  load: () => Promise<T>;
  keys: () => readonly unknown[];
  errorFallback: string;
  enabled?: () => boolean;
  disabledError?: string;
}) {
  const data = ref<T>() as Ref<T | undefined>;
  const loading = ref(false);
  const error = ref("");
  let generation = 0;

  async function reload() {
    if (options.enabled && !options.enabled()) {
      generation++;
      data.value = undefined;
      loading.value = false;
      error.value = options.disabledError ?? "";
      return;
    }
    const current = ++generation;
    data.value = undefined;
    loading.value = true;
    error.value = "";
    try {
      const next = await options.load();
      if (current === generation) data.value = next;
    } catch (err) {
      if (current === generation)
        error.value = err instanceof Error ? err.message : options.errorFallback;
    } finally {
      if (current === generation) loading.value = false;
    }
  }

  watch(options.keys, reload, { immediate: true });
  return { data, loading, error, reload };
}
