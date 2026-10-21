import { chatsOf } from "./chat-registry.ts";
import type { AgentJobView } from "../api/jobs.ts";
import { jobChatTab } from "../lib/job-labels.ts";

interface Commands {
  executeCommand(id: string, args: unknown, options: { scope: string }): Promise<unknown>;
}

/** A job can continue in a chat when it kept a session and worked in the project itself. */
export function canContinueInChat(job: AgentJobView): boolean {
  // A session of an isolated copy belongs to the copy's folder, which the chat does not search.
  return !!job.sessionId && !job.worktree && job.backend in jobChatTab;
}

/**
 * Opens a new chat of the job's agent and resumes the session of the job in it (the same
 * `resumeSession` as for a past session picked in the chat).
 */
export async function continueJobInChat(api: Commands, job: AgentJobView): Promise<void> {
  if (!canContinueInChat(job)) throw new Error("Это задание нельзя продолжить в чате");
  const known = new Set(chatsOf(job.projectId).map((chat) => chat.key));
  await api.executeCommand(`ide.workbench.${jobChatTab[job.backend]}.open`, undefined, {
    scope: `editor:${job.projectId}`,
  });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const chat = chatsOf(job.projectId).find(
      (item) => !known.has(item.key) && item.backend === job.backend,
    );
    if (chat) return chat.resumeSession(job.sessionId!);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Чат не открылся вовремя");
}
