import { ref } from "vue";
import type { GitOverview } from "../../../../core/modules/workspace/index.ts";
import { mutateWorkspaceGit, workspaceRequest } from "../api.ts";

const emptyOverview = (): GitOverview => ({ available: false, branch: "", changes: [] });

/** Состояние Git проекта: поздний ответ устаревшего запроса не перезаписывает свежий. */
export function useGitOverview(projectId: () => string) {
  const git = ref<GitOverview>(emptyOverview());
  const error = ref("");
  const loading = ref(false);
  /** Растёт при каждой перезагрузке: редакторы обновляют по нему маркеры изменённых строк. */
  const gutterRevision = ref(0);
  let generation = 0;
  async function load() {
    const current = ++generation;
    gutterRevision.value++;
    loading.value = true;
    error.value = "";
    try {
      const data = await workspaceRequest<GitOverview>(projectId(), "git");
      if (current === generation) git.value = data;
    } catch (err) {
      if (current === generation) error.value = err instanceof Error ? err.message : "Ошибка Git";
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  async function mutate(action: string, paths: string | string[]) {
    ++generation;
    loading.value = false;
    git.value = await mutateWorkspaceGit(projectId(), action, paths);
    error.value = "";
  }
  /** Сбрасывает обзор при смене проекта и отменяет запросы прежнего. */
  function reset() {
    ++generation;
    git.value = emptyOverview();
  }
  function cancel() {
    ++generation;
  }
  return { git, error, loading, gutterRevision, load, mutate, reset, cancel };
}
export type GitOverviewState = ReturnType<typeof useGitOverview>;
