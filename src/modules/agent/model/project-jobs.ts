import { onScopeDispose, ref } from "vue";
import { fetchJobs, type AgentJobView } from "../api/jobs.ts";

/** How often an open Projector chat asks for the jobs of its project. */
const POLL_MS = 2500;

/** Jobs already continued in this page: a reload or a second watcher must not repeat the turn. */
export const continued = new Set<string>();

/** What the Projector chat sends to itself when a job it started has finished. */
export function continuationPrompt(job: AgentJobView): string {
  return [
    `Фоновое задание ${job.id} (${job.backend}) завершилось: ${job.status}.`,
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
 * The background jobs of a project as they change. A chat uses it to show what runs, to answer
 * the requests of a job and to continue after a job it started. HMR and closed tabs leave no
 * timers behind: the watcher stops with the component scope.
 */
export function useProjectJobs(
  projectId: string,
  onChange?: (job: AgentJobView, before?: AgentJobView) => void,
  enabled: () => boolean = () => true,
) {
  const jobs = ref<AgentJobView[]>([]);
  const error = ref("");
  let previous = new Map<string, AgentJobView>();
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function refresh(): Promise<void> {
    if (disposed || !enabled()) return;
    // A hidden page has nobody to answer or continue: resume polling when it is shown again.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    try {
      const next = await fetchJobs(projectId);
      if (disposed) return;
      error.value = "";
      for (const job of next) {
        const before = previous.get(job.id);
        if (!before) onChange?.(job);
        else if (before.status !== job.status) onChange?.(job, before);
      }
      previous = new Map(next.map((job) => [job.id, job]));
      jobs.value = next;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Не удалось прочитать задания";
    }
  }

  if (enabled()) {
    timer = setInterval(() => void refresh(), POLL_MS);
    void refresh();
  }
  onScopeDispose(() => {
    disposed = true;
    if (timer) clearInterval(timer);
  });

  return { jobs, error, refresh };
}
