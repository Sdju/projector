import {
  jobFinished,
  type AgentJobStatus,
  type AgentJobView,
} from "../../../../agent-core/index.ts";

/** A job that still needs the chat: it runs, waits for the user or is about to start. */
export function jobIsActive(status: AgentJobStatus): boolean {
  return status === "queued" || status === "running" || status === "needs-user";
}

/**
 * What the activity dock shows above the composer: every active job of the project, and the
 * finished jobs this chat started itself. Other chats' finished work stays in their own history.
 */
export function jobBarSections(
  jobs: AgentJobView[],
  chat?: string,
  limit = 8,
): { active: AgentJobView[]; recent: AgentJobView[] } {
  const active = jobs.filter((job) => jobIsActive(job.status));
  const recent = chat
    ? jobs
        .filter((job) => jobFinished(job.status) && job.origin === chat)
        .sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt))
        .slice(0, limit)
    : [];
  return { active, recent };
}
