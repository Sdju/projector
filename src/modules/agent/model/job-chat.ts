import type { AgentJobView } from "../api/jobs.ts";
import { useIdeCommands } from "../../ide/index.ts";
import { jobFinished } from "../api/jobs.ts";
import { resolveJobTitle } from "./job-titles.ts";
import { continuationPrompt, continued, useProjectJobs } from "./project-jobs.ts";

interface Options {
  /** Only the built-in Projector chat shows and continues jobs. */
  enabled: () => boolean;
  /** The key of this chat: only a job it started continues it. */
  chat: string;
  send: (text: string, options?: { auto?: string; autoTitle?: string }) => Promise<void>;
}

const KEY = (id: string) => `projector:job-continued:${id}`;

/** Tabs share localStorage: a job continued in one tab is never continued again in another. */
function marked(id: string): boolean {
  try {
    return localStorage.getItem(KEY(id)) === "1";
  } catch {
    return false;
  }
}

function mark(id: string): void {
  try {
    localStorage.setItem(KEY(id), "1");
  } catch {
    // Private mode without storage: the in-memory set still guards this page.
  }
}

/** Whether a job found by the watcher must continue the chat that started it. */
export function shouldContinue(
  job: AgentJobView,
  before: AgentJobView | undefined,
  chat: string,
  since: number,
): boolean {
  if (job.origin !== chat) return false;
  if (!jobFinished(job.status) || job.status === "stopped") return false;
  if (before && jobFinished(before.status)) return false;
  // A job older than this page may have finished long ago: only one that ended recently continues.
  return !!before || (job.endedAt ?? job.createdAt) >= since - 5000;
}

/**
 * What a Projector chat does with the background jobs of its project: shows them, opens them and
 * continues the conversation when a job it started has finished.
 */
export function useJobChat(projectId: string, options: Options) {
  const api = useIdeCommands().api;
  const since = Date.now();
  const { jobs, refresh } = useProjectJobs(
    projectId,
    (job, before) => {
      if (!options.enabled() || !shouldContinue(job, before, options.chat, since)) return;
      if (continued.has(job.id) || marked(job.id)) return;
      continued.add(job.id);
      mark(job.id);
      void continueAfter(job);
    },
    options.enabled,
  );

  async function continueAfter(job: AgentJobView): Promise<void> {
    try {
      const name = await resolveJobTitle(job);
      await options.send(continuationPrompt(job, name), { auto: job.id, autoTitle: name });
    } catch {
      // The chat shows its own error; a failed continuation must not repeat on the next poll.
    }
  }

  function open(id: string): void {
    void api
      ?.executeCommand(
        "ide.workbench.agent.job.open",
        { job: id },
        {
          scope: `editor:${projectId}`,
        },
      )
      .catch(() => undefined);
  }

  return { jobs, refresh, open };
}
