import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";

interface UsagePollingOptions<T> {
  intervalMs?: number;
  nextCheckAt?: (value: T) => number;
}

/** One request at a time; hidden or unmounted indicators do not keep polling. */
export function useUsagePolling<T>(url: string, options: UsagePollingOptions<T> = {}) {
  const usage = shallowRef<T | null>(null);
  const failed = ref(false);
  const interval = options.intervalMs ?? 60000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let disposed = false;

  async function refresh() {
    if (disposed || controller || document.hidden) return;
    clearTimeout(timer);
    controller = new AbortController();
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error("Usage unavailable");
      const value: T = await response.json();
      if (!disposed) {
        usage.value = value;
        failed.value = false;
      }
    } catch {
      if (!disposed) failed.value = true;
    } finally {
      controller = undefined;
      if (!disposed) {
        const nextCheckAt = usage.value && options.nextCheckAt?.(usage.value);
        timer = setTimeout(refresh, Math.max(interval, (nextCheckAt ?? 0) - Date.now()));
      }
    }
  }

  function visibilityChanged() {
    if (!document.hidden) void refresh();
  }
  onMounted(() => {
    void refresh();
    document.addEventListener("visibilitychange", visibilityChanged);
  });
  onBeforeUnmount(() => {
    disposed = true;
    clearTimeout(timer);
    controller?.abort();
    document.removeEventListener("visibilitychange", visibilityChanged);
  });
  return { usage, failed };
}
