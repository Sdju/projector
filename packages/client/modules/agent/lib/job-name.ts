import type { AgentJobView } from "../api/jobs.ts";

/**
 * A short name for a job before the agent names its session: the first sentence of the task,
 * cut on a word boundary. The full task stays in the job tab and in the row's tooltip.
 */
export function jobShortTitle(task: string, limit = 80): string {
  const line = task.replace(/\s+/g, " ").trim();
  if (!line) return "Задание";
  if (line.length <= limit) return line;
  const cut = line.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  const base = (stop >= Math.min(40, limit / 2) ? cut.slice(0, stop + 1) : cut).trimEnd();
  return /[.!?]$/.test(base) ? base : `${base}…`;
}

/** The name of a job: its native session title when known, otherwise the short task. */
export function jobTitleOf(job: AgentJobView, titles?: Map<string, string>): string {
  const session = job.sessionId ? titles?.get(job.sessionId)?.trim() : "";
  return session || jobShortTitle(job.task);
}
