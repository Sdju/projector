import { jobFinished, type AgentJobStatus, type AgentJobView } from "../api/jobs.ts";
import { agentLabel } from "../model/modes.ts";
import { notifyJob } from "./notify.ts";

export interface JobNotice {
  id: string;
  title: string;
  body: string;
}

/**
 * What the user should hear after the jobs changed: a job that now waits for them, or ended.
 * `known` holds the last status seen of each job and is updated; the first sight of a job only
 * records it (an old finished job must not notify when the page opens).
 */
export function jobNotices(known: Map<string, AgentJobStatus>, jobs: AgentJobView[]): JobNotice[] {
  const notices: JobNotice[] = [];
  const first = known.size === 0;
  for (const job of jobs) {
    const before = known.get(job.id);
    known.set(job.id, job.status);
    if (before === job.status || (before === undefined && (first || jobFinished(job.status))))
      continue;
    const who = agentLabel(job.backend);
    const task = job.task.trim().slice(0, 120);
    if (job.status === "needs-user") {
      const card = job.pending[0];
      notices.push({
        id: job.id,
        title: `${who} ждёт вашего ответа`,
        body: card ? `${card.title}: ${task}` : task,
      });
    } else if (jobFinished(job.status)) {
      notices.push({
        id: job.id,
        title:
          job.status === "done"
            ? `${who} закончил задание`
            : job.status === "error"
              ? `${who}: задание завершилось ошибкой`
              : `${who}: задание остановлено`,
        body: job.status === "error" && job.error ? job.error : task,
      });
    }
  }
  return notices;
}

export function announceJobs(known: Map<string, AgentJobStatus>, jobs: AgentJobView[]): void {
  for (const notice of jobNotices(known, jobs)) notifyJob(notice.id, notice.title, notice.body);
}
