import { randomUUID } from "node:crypto";
import type { Project } from "../../../core/modules/project/index.ts";
import { HttpError } from "../http/index.ts";
import { cloneGithubProject, type CloneHooks } from "./github-clone.ts";

export type CloneJobPhase =
  | "queued"
  | "preparing"
  | "pulling"
  | "cloning"
  | "finishing"
  | "done"
  | "error"
  | "cancelled";
export interface CloneJob {
  id: string;
  repository: string;
  phase: CloneJobPhase;
  /** Human-readable current step, or the failure reason. */
  message: string;
  startedAt: number;
  project?: Project;
}

const MESSAGES: Partial<Record<CloneJobPhase, string>> = {
  queued: "В очереди",
  preparing: "Проверяю Docker и образ",
  pulling: "Скачиваю образ Docker",
  cloning: "Клонирую репозиторий",
  finishing: "Добавляю проект",
  done: "Готово",
  cancelled: "Клонирование отменено",
};
const FINISHED = new Set<CloneJobPhase>(["done", "error", "cancelled"]);
const KEEP = 20;
interface Entry {
  job: CloneJob;
  controller: AbortController;
}
const jobs = new Map<string, Entry>();

const active = (entry: Entry) => !FINISHED.has(entry.job.phase);
function prune() {
  const finished = [...jobs.values()].filter((entry) => !active(entry));
  for (const entry of finished.slice(0, Math.max(0, finished.length - KEEP)))
    jobs.delete(entry.job.id);
}

/** Starts a clone in the background; the caller polls `cloneJob` and may `cancelCloneJob`. */
export function startCloneJob(
  body: Record<string, unknown>,
  run: (
    body: Record<string, unknown>,
    hooks: CloneHooks,
  ) => Promise<{ project: Project }> = cloneGithubProject,
): CloneJob {
  const repository = typeof body.repository === "string" ? body.repository : "";
  const controller = new AbortController();
  const job: CloneJob = {
    id: randomUUID(),
    repository,
    phase: "queued",
    message: MESSAGES.queued!,
    startedAt: Date.now(),
  };
  const entry = { job, controller };
  jobs.set(job.id, entry);
  const set = (phase: CloneJobPhase, message = MESSAGES[phase] ?? "") => {
    // The first terminal state wins: a late phase update must not resurrect a cancelled job.
    if (!FINISHED.has(job.phase)) Object.assign(job, { phase, message });
  };
  void run(body, { signal: controller.signal, phase: set })
    .then(({ project }) => {
      if (controller.signal.aborted) return;
      job.project = project;
      set("done");
    })
    .catch((error: Error) => {
      if (controller.signal.aborted) set("cancelled");
      else set("error", error.message || "Не удалось клонировать репозиторий");
    })
    .finally(prune);
  return job;
}
export function cloneJob(id: string): CloneJob {
  const entry = jobs.get(id);
  if (!entry) throw new HttpError(404, "Задача клонирования не найдена");
  return entry.job;
}
export function cancelCloneJob(id: string): CloneJob {
  const entry = jobs.get(id);
  if (!entry) throw new HttpError(404, "Задача клонирования не найдена");
  if (active(entry)) entry.controller.abort();
  return entry.job;
}
