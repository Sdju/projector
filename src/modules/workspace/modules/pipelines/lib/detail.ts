import { ref, shallowRef, watch } from "vue";
import type {
  PipelineDetail,
  PipelineJobDetail,
} from "../../../../../../core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

function useCiDetail<T>(
  projectId: () => string,
  id: () => number,
  action: "pipeline" | "job",
  failure: string,
) {
  const detail = shallowRef<T>();
  const loading = ref(false);
  const error = ref("");
  const revision = ref(0);
  watch(
    () => [projectId(), id(), revision.value] as const,
    async ([currentProject, currentId], _, onCleanup) => {
      const controller = new AbortController();
      let active = true;
      onCleanup(() => {
        active = false;
        controller.abort();
      });
      loading.value = true;
      error.value = "";
      try {
        const data = await workspaceRequest<T>(
          currentProject,
          action,
          { id: String(currentId) },
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
  return { detail, loading, error, reload: () => revision.value++ };
}

export function usePipelineDetail(projectId: () => string, id: () => number) {
  return useCiDetail<PipelineDetail>(projectId, id, "pipeline", "Не удалось открыть pipeline");
}

export function useJobDetail(projectId: () => string, id: () => number) {
  return useCiDetail<PipelineJobDetail>(projectId, id, "job", "Не удалось открыть джоб");
}
