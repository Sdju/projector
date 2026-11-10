import { ref, shallowRef, watch } from "vue";
import type {
  PipelineDetail,
  PipelineJobDetail,
  PipelineStatus,
} from "@projector-ai/core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

function useCiDetail<T>(
  projectId: () => string,
  id: () => number,
  action: "pipeline" | "job",
  failure: string,
  live?: (data: T) => boolean,
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
      let timer: ReturnType<typeof setTimeout> | undefined;
      onCleanup(() => {
        active = false;
        clearTimeout(timer);
        controller.abort();
      });
      loading.value = !detail.value;
      error.value = "";
      try {
        const data = await workspaceRequest<T>(
          currentProject,
          action,
          { id: String(currentId) },
          controller.signal,
        );
        if (!active) return;
        detail.value = data;
        // A running run changes while it is open: keep its status and jobs fresh.
        if (live?.(data)) timer = setTimeout(() => revision.value++, 10_000);
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

const ACTIVE = new Set<PipelineStatus>(["queued", "running"]);

export function usePipelineDetail(projectId: () => string, id: () => number) {
  return useCiDetail<PipelineDetail>(
    projectId,
    id,
    "pipeline",
    "Не удалось открыть pipeline",
    (data) => ACTIVE.has(data.pipeline.status),
  );
}

export function useJobDetail(projectId: () => string, id: () => number) {
  return useCiDetail<PipelineJobDetail>(projectId, id, "job", "Не удалось открыть джоб", (data) =>
    ACTIVE.has(data.job.status),
  );
}
