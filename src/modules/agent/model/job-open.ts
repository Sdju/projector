import { ref, watch } from "vue";
import { useIdeCommands } from "../../ide/index.ts";

/** A job whose tab a page outside the workspace (the activity island) wants shown. */
const request = ref<{ projectId: string; job: string } | undefined>();

export function requestJobTab(projectId: string, job: string): void {
  request.value = { projectId, job };
}

const RETRIES = 20;
const RETRY_MS = 150;

/**
 * Called once by the workspace of a project (inside its setup): opens the tab of a job requested
 * for this project. The workspace may still be restoring its tabs, so a refusal is retried.
 */
export function useJobTabRequests(projectId: string): void {
  const { api } = useIdeCommands();
  let attempt = 0;
  async function open(): Promise<void> {
    const wanted = request.value;
    if (!wanted || wanted.projectId !== projectId) return;
    try {
      await api.executeCommand(
        "ide.workbench.agent.job.open",
        { job: wanted.job },
        { scope: `editor:${projectId}` },
      );
      if (request.value === wanted) request.value = undefined;
      attempt = 0;
    } catch {
      if (++attempt <= RETRIES) setTimeout(() => void open(), RETRY_MS);
    }
  }
  watch(request, () => void open(), { immediate: true });
}
