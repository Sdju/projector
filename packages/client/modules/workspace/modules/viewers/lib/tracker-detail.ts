import { ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import type {
  DiscussionDetail,
  IssueDetail,
  PullRequestDetail,
} from "@ai-projector/core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

export interface TrackerDetailState<T> {
  detail: ShallowRef<T | undefined>;
  loading: Ref<boolean>;
  error: Ref<string>;
  reload(): void;
}

/** Загрузка деталей tracker; смена вкладки и unmount отменяют применение старого ответа. */
export function useTrackerDetail(
  projectId: () => string,
  number: () => number,
  action: "issue",
  failure: string,
): TrackerDetailState<IssueDetail>;
export function useTrackerDetail(
  projectId: () => string,
  number: () => number,
  action: "pull",
  failure: string,
): TrackerDetailState<PullRequestDetail>;
export function useTrackerDetail(
  projectId: () => string,
  number: () => number,
  action: "discussion",
  failure: string,
): TrackerDetailState<DiscussionDetail>;
export function useTrackerDetail(
  projectId: () => string,
  number: () => number,
  action: "issue" | "pull" | "discussion",
  failure: string,
): TrackerDetailState<IssueDetail | PullRequestDetail | DiscussionDetail> {
  const detail = shallowRef<IssueDetail | PullRequestDetail | DiscussionDetail>();
  const loading = ref(false);
  const error = ref("");
  const revision = ref(0);
  watch(
    () => [projectId(), number(), revision.value] as const,
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
        const data = await workspaceRequest(
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
  return { detail, loading, error, reload: () => revision.value++ };
}
