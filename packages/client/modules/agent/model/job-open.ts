import { ref, watch } from "vue";
import { useIdeCommands } from "../../ide/index.ts";
import { chatTabCommand } from "../lib/chat-tab.ts";

/** A tab that a page outside the workspace (the activity island) wants shown in a project. */
const request = ref<
  { projectId: string; command: string; args: Record<string, string> } | undefined
>();

export function requestJobTab(projectId: string, job: string): void {
  request.value = { projectId, command: "ide.workbench.agent.job.open", args: { job } };
}

/** Asks for the tab of an agent chat; `false` when the chat has no tab of its own to show. */
export function requestChatTab(projectId: string, chat: string): boolean {
  const tab = chatTabCommand(projectId, chat);
  if (tab) request.value = { projectId, command: tab.command, args: tab.args };
  return !!tab;
}

const RETRIES = 20;
const RETRY_MS = 150;

/**
 * Called once by the workspace of a project (inside its setup): opens the tab requested for this
 * project. The workspace may still be restoring its tabs, so a refusal is retried.
 */
export function useJobTabRequests(projectId: string): void {
  const { api } = useIdeCommands();
  let attempt = 0;
  async function open(): Promise<void> {
    const wanted = request.value;
    if (!wanted || wanted.projectId !== projectId) return;
    try {
      await api.executeCommand(wanted.command, wanted.args, { scope: `editor:${projectId}` });
      if (request.value === wanted) request.value = undefined;
      attempt = 0;
    } catch {
      if (++attempt <= RETRIES) setTimeout(() => void open(), RETRY_MS);
    }
  }
  watch(request, () => void open(), { immediate: true });
}
