import { isFinished, live, persist, wake } from "./jobs-live.ts";
import { jobIds, loadJob, saveJob, type AgentJob } from "./jobs-store.ts";
import { readJob, startJob } from "./jobs.ts";
import { loadProjects } from "../projects/index.ts";
import { forkWorktree } from "./worktrees.ts";

/** A copy is being transferred right now: two retries must not start in the same worktree. */
const host = globalThis as typeof globalThis & { projectorJobCopies?: Set<string> };
const copies = (host.projectorJobCopies ??= new Set<string>());

/** Forgets the copy of a finished job after it was merged or thrown away. */
export async function clearJobWorktree(id: string, projectPath?: string): Promise<AgentJob | null> {
  const settled = (job: AgentJob) => {
    if (!isFinished(job.status)) throw new Error("Дождитесь завершения задания");
    if (job.worktree) {
      delete job.worktree;
      // The folder is gone: the record must not point at it, and its session cannot be resumed.
      if (projectPath) job.cwd = projectPath;
      delete job.sessionId;
      delete job.base;
      delete job.dirty;
      job.rev++;
    }
    return job;
  };
  const entry = live.get(id);
  if (entry) {
    const job = settled(entry.job);
    await persist(entry);
    wake(entry);
    return structuredClone(job);
  }
  const job = await loadJob(id);
  if (!job) return null;
  settled(job);
  await saveJob(job);
  return job;
}

/** Starts a second job in a new copy that begins from what this job's copy has now. */
export async function forkJob(id: string, task?: string): Promise<AgentJob | null> {
  const found = await readJob(id);
  if (!found) return null;
  const { job } = found;
  if (!isFinished(job.status)) throw new Error("Дождитесь завершения задания");
  if (!job.worktree) throw new Error("Форк доступен только заданию в изолированной копии");
  const project = (await loadProjects()).find((item) => item.id === job.projectId);
  if (!project) throw new Error("Проект не найден");
  const copy = await forkWorktree(project.id, project.path, job.cwd);
  return startJob({
    backend: job.backend,
    task: task?.trim() || job.task,
    projectId: job.projectId,
    cwd: copy.cwd,
    worktree: { id: copy.id, branch: copy.branch },
    origin: job.origin,
    selection: job.selection,
    permissionMode: job.permissionMode,
    unattended: job.unattended,
  });
}

/** Starts the same task again after a failure: the same folder, copy and native session. */
export async function retryJob(
  id: string,
  task?: string,
  append = false,
): Promise<AgentJob | null> {
  const found = await readJob(id);
  if (!found) return null;
  const { job } = found;
  if (!isFinished(job.status)) throw new Error("Задание ещё работает");
  const text = task?.trim();
  // A follow-up keeps the original goal; a retry with new words replaces it.
  const nextTask = text ? (append ? `${job.task}\n\n${text}` : text) : job.task;
  const worktree = job.worktree;
  if (worktree) {
    if (copies.has(worktree.id)) throw new Error("Копия уже занята другим заданием");
    copies.add(worktree.id);
  }
  try {
    if (worktree) {
      const jobs = await Promise.all(
        (await jobIds()).map(async (item) => live.get(item)?.job ?? (await loadJob(item))),
      );
      const busy = jobs.find(
        (other) =>
          other &&
          other.id !== id &&
          !isFinished(other.status) &&
          other.worktree?.id === worktree.id,
      );
      if (busy) throw new Error("Копия уже занята другим заданием");
    }
    const next = await startJob({
      backend: job.backend,
      task: nextTask,
      projectId: job.projectId,
      cwd: job.cwd,
      worktree,
      origin: job.origin,
      sessionId: job.sessionId,
      selection: job.selection,
      permissionMode: job.permissionMode,
      unattended: job.unattended,
    });
    // The copy belongs to the new run now: the old record must not offer merge/discard on it.
    if (worktree) {
      const project = (await loadProjects()).find((item) => item.id === job.projectId);
      await clearJobWorktree(id, project?.path);
    }
    return next;
  } finally {
    if (worktree) copies.delete(worktree.id);
  }
}
