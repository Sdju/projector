import { useDebounceFn, useEventListener } from "@vueuse/core";
import { onScopeDispose, watch } from "vue";
import type { z } from "zod";

/** Only UI metadata is watched; file content and editor keystrokes never trigger writes. */
export function useSessionSnapshot<T>(
  key: () => string,
  snapshot: () => T,
  schema: z.ZodType<T>,
  enabled: () => boolean = () => true,
) {
  let currentKey = key();
  let pending = false;
  function flush() {
    if (!pending || !enabled()) return;
    pending = false;
    try {
      const value = JSON.stringify(snapshot());
      if (sessionStorage.getItem(currentKey) !== value) sessionStorage.setItem(currentKey, value);
    } catch {
      // Storage may be unavailable or full; the workspace must remain usable.
    }
  }
  const save = useDebounceFn(flush, 600, { maxWait: 2500 });
  watch(
    key,
    (value) => {
      flush();
      pending = false;
      currentKey = value;
    },
    { flush: "sync" },
  );
  watch(
    () => [snapshot(), enabled()],
    () => {
      if (!enabled()) return;
      pending = true;
      void save();
    },
    { flush: "sync" },
  );
  useEventListener(window, "pagehide", flush);
  useEventListener(window, "beforeunload", flush);
  useEventListener(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  onScopeDispose(flush);
  function read(): T | undefined {
    try {
      const value = sessionStorage.getItem(currentKey);
      if (value === null) return;
      const result = schema.safeParse(JSON.parse(value));
      return result.success ? result.data : undefined;
    } catch {
      return undefined;
    }
  }
  return { read, flush };
}
