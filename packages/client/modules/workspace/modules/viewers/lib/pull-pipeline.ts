import { ref, shallowRef, watch } from "vue";
import type { PipelineDetail, PipelineStatus } from "@projector-ai/core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

const ACTIVE = new Set<PipelineStatus>(["queued", "running"]);

/** Pipeline of a merge request; a running run refreshes while the stages stay expanded. */
export function usePullPipeline(projectId: () => string, id: () => number) {
  const detail = shallowRef<PipelineDetail>();
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
        const data = await workspaceRequest<PipelineDetail>(
          currentProject,
          "pipeline",
          { id: String(currentId) },
          controller.signal,
        );
        if (!active) return;
        detail.value = data;
        if (ACTIVE.has(data.pipeline.status)) timer = setTimeout(() => revision.value++, 10_000);
      } catch (err) {
        if (active)
          error.value = err instanceof Error ? err.message : "Не удалось открыть pipeline";
      } finally {
        if (active) loading.value = false;
      }
    },
    { immediate: true },
  );
  return { detail, loading, error, reload: () => revision.value++ };
}
