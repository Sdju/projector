import { computed, getCurrentScope, onScopeDispose } from "vue";
import {
  agentLabel,
  jobFinished,
  openChats,
  type AgentJobView,
} from "../../../../agent-core/index.ts";
import { announceJobs } from "../lib/job-notify.ts";
import { useJobsFeed } from "./jobs-feed.ts";

/** An open chat that is answering or has subagents and background commands running. */
export interface AgentActivityItem {
  chat: string;
  projectId: string;
  agent: string;
  /** What the user asked last. */
  topic: string;
  busy: boolean;
  /** Subagents and background commands still running. */
  tasks: number;
  /** When the agent started the work shown, for the elapsed time in the island. */
  startedAt?: number;
  /** A background job: its id (the tab opens by it) and what it waits for. */
  job?: { id: string; status: AgentJobView["status"] };
  /** The agent waits for the user's answer. */
  needsUser?: boolean;
}

/** The island's rows for background jobs: the unfinished ones; one that waits for the user is marked. */
export function jobItems(jobs: AgentJobView[]): AgentActivityItem[] {
  return jobs
    .filter((job) => !jobFinished(job.status))
    .map((job) => ({
      chat: `job:${job.id}`,
      projectId: job.projectId,
      agent: agentLabel(job.backend),
      topic: job.task.trim().slice(0, 120),
      busy: job.status !== "needs-user",
      tasks: 0,
      startedAt: job.startedAt,
      job: { id: job.id, status: job.status },
      needsUser: job.status === "needs-user",
    }));
}

/**
 * Chats that work right now: the open ones of this page, the runs started anywhere else and the
 * background jobs of the server. The lists come from the page's shared feed, which the server
 * updates over the event stream instead of keeping a timer per component.
 */
export function useAgentActivity() {
  const feed = useJobsFeed();
  // Statuses seen so far: a change to "needs you" or "ended" notifies a page the user is not on.
  const seen = new Map<string, AgentJobView["status"]>();
  const stop = feed.onUpdate(({ jobs }) => announceJobs(seen, jobs));
  if (getCurrentScope()) onScopeDispose(stop);

  const items = computed<AgentActivityItem[]>(() => {
    const local = openChats()
      .map((chat) => ({
        chat: chat.key,
        projectId: chat.projectId,
        agent: chat.label,
        topic:
          chat
            .turns()
            .findLast((turn) => turn.role === "user")
            ?.text.trim()
            .slice(0, 120) ?? "",
        busy: chat.busy(),
        tasks: chat.tasks().filter((task) => task.status === "running").length,
        startedAt: chat.turns().findLast((turn) => turn.role === "assistant")?.at,
      }))
      .filter((item) => item.busy || item.tasks);
    // The page's own chat knows more (background tasks) than the run on the server.
    // An idle/disconnected view must not hide the server's still-running agent.
    const known = new Set(local.map((chat) => chat.chat));
    const remote = feed.runs.value
      .filter((run) => {
        const key = run.chat || run.id;
        if (known.has(key)) return false;
        known.add(key);
        return true;
      })
      .map((run) => ({
        chat: run.chat || run.id,
        projectId: run.projectId,
        agent: agentLabel(run.backend),
        topic: run.topic,
        busy: true,
        tasks: 0,
        startedAt: run.startedAt,
      }));
    const jobs = jobItems(feed.jobs.value);
    return [...local, ...remote, ...jobs];
  });
  return { items, jobs: feed.jobs };
}
