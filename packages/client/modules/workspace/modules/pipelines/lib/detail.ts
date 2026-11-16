import { ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import type {
  PipelineDetail,
  PipelineJobDetail,
  PipelineStatus,
} from "@ai-projector/core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

export interface CiDetailState<T> {
  detail: ShallowRef<T | undefined>;
  loading: Ref<boolean>;
  error: Ref<string>;
  reload(): void;
}

function useCiDetail<T>(
  projectId: () => string,
  id: () => number,
  readCi: (project: string, id: number, signal: AbortSignal) => Promise<T>,
  failure: string,
  live?: (data: T) => boolean,
): CiDetailState<T> {
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
        const data = await readCi(currentProject, currentId, controller.signal);
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
  return useCiDetail(
    projectId,
    id,
    (project, pipeline, signal) =>
      workspaceRequest(project, "pipeline", { id: String(pipeline) }, signal),
    "Не удалось открыть pipeline",
    (data: PipelineDetail) => ACTIVE.has(data.pipeline.status),
  );
}

export function useJobDetail(projectId: () => string, id: () => number) {
  return useCiDetail(
    projectId,
    id,
    (project, job, signal) => workspaceRequest(project, "job", { id: String(job) }, signal),
    "Не удалось открыть джоб",
    (data: PipelineJobDetail) => ACTIVE.has(data.job.status),
  );
}
