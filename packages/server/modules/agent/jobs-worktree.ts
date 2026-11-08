import { isFinished, live, persist, wake } from "./jobs-live.ts";
import { jobIds, loadJob, publicJob, saveJob, type AgentJob } from "./jobs-store.ts";
import { readJob, startJob } from "./jobs.ts";
import { loadProjects } from "../projects/index.ts";
import { forkWorktree, mergeWorktree, removeWorktree } from "./worktrees.ts";

/** Copy mutations are exclusive across retry, fork, follow-up, merge and discard. */
const host = globalThis as typeof globalThis & { projectorJobCopies?: Set<string> };
const copies = (host.projectorJobCopies ??= new Set<string>());

export function holdJobWorktree(id: string): () => void {
  if (copies.has(id)) throw new Error("Копия уже занята другим заданием");
  copies.add(id);
  return () => copies.delete(id);
}

async function assertCopyFree(id: string, owner: string): Promise<void> {
  const jobs = await Promise.all(
    (await jobIds()).map(async (item) => live.get(item)?.job ?? (await loadJob(item))),
  );
  if (
    jobs.some(
      (job) => job && job.id !== owner && !isFinished(job.status) && job.worktree?.id === id,
    )
  )
    throw new Error("Копия уже занята другим заданием");
}

function finishedCopy(job: AgentJob): { id: string; branch: string } {
  if (!isFinished(job.status)) throw new Error("Дождитесь завершения задания");
  if (!job.worktree) throw new Error("Задание работает без копии");
  return job.worktree;
}

/** Forgets the copy without making its old record read or resume another folder. */
export async function clearJobWorktree(id: string): Promise<AgentJob | null> {
  const settled = (job: AgentJob) => {
    if (!isFinished(job.status)) throw new Error("Дождитесь завершения задания");
    if (job.worktree) {
      delete job.worktree;
      job.worktreeCleared = true;
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
    return publicJob(job);
  }
  const job = await loadJob(id);
  if (!job) return null;
  settled(job);
  await saveJob(job);
  return publicJob(job);
}

/** Starts a second job in a new copy that begins from what this job's copy has now. */
export async function forkJob(id: string, task?: string): Promise<AgentJob | null> {
  const initial = await readJob(id);
  if (!initial) return null;
  const worktree = finishedCopy(initial.job);
  const release = holdJobWorktree(worktree.id);
  try {
    const found = await readJob(id);
    if (!found) return null;
    const { job } = found;
    finishedCopy(job);
    await assertCopyFree(worktree.id, id);
    const project = (await loadProjects()).find((item) => item.id === job.projectId);
    if (!project) throw new Error("Проект не найден");
    const copy = await forkWorktree(project.id, project.path, job.cwd);
    return await startJob({
      backend: job.backend,
      task: task?.trim() || job.task,
      projectId: job.projectId,
      cwd: copy.cwd,
      worktree: { id: copy.id, branch: copy.branch },
      origin: job.origin,
      role: job.role,
      selection: job.selection,
      permissionMode: job.permissionMode,
      unattended: job.unattended,
    });
  } finally {
    release();
  }
}

/** Starts the same task again after a failure: the same folder, copy and native session. */
export async function retryJob(
  id: string,
  task?: string,
  append = false,
): Promise<AgentJob | null> {
  const initial = await readJob(id);
  if (!initial) return null;
  if (initial.job.worktreeCleared)
    throw new Error("Копия задания удалена или передана другому заданию");
  if (!isFinished(initial.job.status)) throw new Error("Задание ещё работает");
  const worktree = initial.job.worktree;
  const release = worktree ? holdJobWorktree(worktree.id) : undefined;
  try {
    const found = await readJob(id);
    if (!found) return null;
    const { job } = found;
    if (job.worktreeCleared || !isFinished(job.status))
      throw new Error("Задание ещё работает или его копия уже передана");
    const text = task?.trim();
    // A follow-up keeps the original goal; a retry with new words replaces it.
    const nextTask = text ? (append ? `${job.task}\n\n${text}` : text) : job.task;
    if (worktree) await assertCopyFree(worktree.id, id);
    const next = await startJob({
      backend: job.backend,
      task: nextTask,
      projectId: job.projectId,
      cwd: job.cwd,
      worktree,
      origin: job.origin,
      sessionId: job.sessionId,
      role: job.role,
      selection: job.selection,
      permissionMode: job.permissionMode,
      unattended: job.unattended,
    });
    // The copy belongs to the new run now: the old record must not offer merge/discard on it.
    if (worktree) await clearJobWorktree(id);
    return next;
  } finally {
    release?.();
  }
}

/** Merges or discards a copy only while no other job owns or is transferring it. */
export async function settleJobWorktree(id: string, action: "merge" | "discard") {
  const initial = await readJob(id);
  if (!initial) return null;
  const worktree = finishedCopy(initial.job);
  const release = holdJobWorktree(worktree.id);
  try {
    const found = await readJob(id);
    if (!found) return null;
    const { job } = found;
    finishedCopy(job);
    await assertCopyFree(worktree.id, id);
    const project = (await loadProjects()).find((item) => item.id === job.projectId);
    if (!project) throw new Error("Проект не найден");
    const result =
      action === "merge"
        ? await mergeWorktree(project.id, worktree.id, project.path)
        : (await removeWorktree(project.id, worktree.id, project.path), { discarded: true });
    return { ...result, job: await clearJobWorktree(id) };
  } finally {
    release();
  }
}
