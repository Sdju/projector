import { ref, shallowRef, watch } from "vue";
import type { ReleaseDetail } from "@ai-projector/core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

/** One release; unlike CI runs it does not change while it is open. */
export function useReleaseDetail(projectId: () => string, tag: () => string) {
  const detail = shallowRef<ReleaseDetail>();
  const loading = ref(false);
  const error = ref("");
  const revision = ref(0);
  watch(
    () => [projectId(), tag(), revision.value] as const,
    async ([currentProject, currentTag], _, onCleanup) => {
      const controller = new AbortController();
      let active = true;
      onCleanup(() => {
        active = false;
        controller.abort();
      });
      loading.value = !detail.value;
      error.value = "";
      try {
        const data = await workspaceRequest<ReleaseDetail>(
          currentProject,
          "release",
          { tag: currentTag },
          controller.signal,
        );
        if (active) detail.value = data;
      } catch (err) {
        if (active) error.value = err instanceof Error ? err.message : "Не удалось открыть релиз";
      } finally {
        if (active) loading.value = false;
      }
    },
    { immediate: true },
  );
  return { detail, loading, error, reload: () => revision.value++ };
}
