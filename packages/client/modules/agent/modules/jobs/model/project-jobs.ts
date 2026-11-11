import { computed, getCurrentScope, onScopeDispose, ref } from "vue";
import type { AgentJobView } from "../../../../agent-core/index.ts";
import { jobShortTitle } from "../lib/job-name.ts";
import { useJobsFeed } from "./jobs-feed.ts";

/** Jobs already continued in this page: a reload or a second watcher must not repeat the turn. */
export const continued = new Set<string>();

/** What the Projector chat sends to itself when a job it started has finished. */
export function continuationPrompt(job: AgentJobView, name = jobShortTitle(job.task)): string {
  return [
    `Фоновое задание «${name}» (${job.id}, ${job.backend}) завершилось: ${job.status}.`,
    job.error ? `Ошибка: ${job.error}` : "",
    "Проверь результат командами ide.agent.job.result, ide.agent.job.diff и ide.agent.job.log, сверь с заданием и скажи пользователю, что изменилось и чем это проверено.",
    job.worktree
      ? "Работа шла в изолированной копии: слияние — ide.agent.job.merge, только по просьбе пользователя."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The background jobs of a project as they change. The page's shared feed holds the lists, which
 * the server updates over the event stream; this watcher only filters them by project and reports
 * what changed. A chat uses it to show what runs, to answer job requests and to continue after a
 * job it started.
 */
export function useProjectJobs(
  projectId: string,
  onChange?: (job: AgentJobView, before?: AgentJobView) => void,
  enabled: () => boolean = () => true,
) {
  if (!enabled())
    return {
      jobs: ref<AgentJobView[]>([]),
      error: ref(""),
      refresh: async () => {},
    };

  const feed = useJobsFeed();
  const previous = new Map<string, AgentJobView>();
  const jobs = computed(() => feed.jobs.value.filter((job) => job.projectId === projectId));

  const stop = feed.onUpdate(({ jobs: next }) => {
    // A hidden page has nobody to answer or continue: compare when it is shown again.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const own = next.filter((job) => job.projectId === projectId);
    for (const job of own) {
      const before = previous.get(job.id);
      if (!before) onChange?.(job);
      else if (before.status !== job.status) onChange?.(job, before);
    }
    previous.clear();
    for (const job of own) previous.set(job.id, job);
  });
  if (getCurrentScope()) onScopeDispose(stop);

  async function refresh(): Promise<void> {
    if (enabled()) await feed.refresh();
  }

  return { jobs, error: feed.error, refresh };
}
