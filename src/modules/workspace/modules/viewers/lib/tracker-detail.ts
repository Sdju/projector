import { ref, shallowRef, watch } from "vue";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

/** Загрузка деталей tracker; смена вкладки и unmount отменяют применение старого ответа. */
export function useTrackerDetail<T>(
  projectId: () => string,
  number: () => number,
  action: "issue" | "pull" | "discussion",
  failure: string,
) {
  const detail = shallowRef<T>();
  const loading = ref(false);
  const error = ref("");
  watch(
    () => [projectId(), number()] as const,
    async ([projectId, number], _, onCleanup) => {
      const controller = new AbortController();
      let active = true;
      onCleanup(() => {
        active = false;
        controller.abort();
      });
      loading.value = true;
      error.value = "";
      detail.value = undefined;
      try {
        const data = await workspaceRequest<T>(
          projectId,
          action,
          { number: String(number) },
          controller.signal,
        );
        if (active) detail.value = data;
      } catch (err) {
        if (active) error.value = err instanceof Error ? err.message : failure;
      } finally {
        if (active) loading.value = false;
      }
    },
    { immediate: true },
  );
  return { detail, loading, error };
}
