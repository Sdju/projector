import { ref } from "vue";
import type { GitBranches, GitSyncAction } from "@projector-ai/core/modules/workspace/index.ts";
import {
  mutateWorkspaceBranch,
  mutateWorkspaceSync,
  workspaceRequest,
} from "../../../../workspace-api/index.ts";

const empty = (): GitBranches => ({
  available: false,
  current: "",
  detached: false,
  remotes: [],
  branches: [],
});

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
  /** Стягивает, отправляет или забирает ссылки; свежий список и итог приходят одним ответом. */
  async function sync(action: GitSyncAction) {
    ++generation;
    loading.value = false;
    const result = await mutateWorkspaceSync(projectId(), action);
    state.value = result.branches;
    error.value = "";
    return result;
  }
  function reset() {
    ++generation;
    state.value = empty();
    error.value = "";
    loading.value = false;
  }
  return { state, error, loading, load, mutate, sync, reset };
}
export type GitBranchesState = ReturnType<typeof useGitBranches>;
