import { ref } from "vue";
import type { GitBranches } from "../../../../../../core/modules/workspace/index.ts";
import { mutateWorkspaceBranch, workspaceRequest } from "../../../../workspace-api/index.ts";

const empty = (): GitBranches => ({ available: false, current: "", detached: false, branches: [] });

/** Ветки проекта: поздний ответ устаревшего запроса не перезаписывает свежий. */
export function useGitBranches(projectId: () => string) {
  const state = ref<GitBranches>(empty());
  const error = ref("");
  const loading = ref(false);
  let generation = 0;
  async function load() {
    const current = ++generation;
    loading.value = true;
    error.value = "";
    try {
      const data = await workspaceRequest<GitBranches>(projectId(), "branches");
      if (current === generation) state.value = data;
    } catch (err) {
      if (current === generation) error.value = err instanceof Error ? err.message : "Ошибка Git";
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  /** Выполняет операцию и принимает свежий список из ответа; ошибку Git передаёт вызывающему. */
  async function mutate(action: string, input: Parameters<typeof mutateWorkspaceBranch>[2]) {
    ++generation;
    loading.value = false;
    state.value = await mutateWorkspaceBranch(projectId(), action, input);
    error.value = "";
  }
  function reset() {
    ++generation;
    state.value = empty();
    error.value = "";
    loading.value = false;
  }
  return { state, error, loading, load, mutate, reset };
}
export type GitBranchesState = ReturnType<typeof useGitBranches>;
