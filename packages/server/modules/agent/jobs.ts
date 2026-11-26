import { randomUUID } from "node:crypto";
import { completeCommandRequest } from "./command-bridge.ts";
import { removeRun, stopRun } from "./agent-runs.ts";
import type { AgentBackendId, AgentPermissionMode } from "./backend.ts";
import type { AgentSelection } from "./controls.ts";
import type { AgentRoleSnapshot } from "@ai-projector/core/modules/agent-role/index.ts";
import { answerPreview } from "@ai-projector/core/modules/agent-answer/index.ts";
import { dropPending, isFinished, live, persist, record, type Live } from "./jobs-live.ts";
import {
  JOB_RETAIN_MS,
  jobIds,
  loadJob,
  loadJournal,
  newJobId,
  publicJob,
  removeJobFiles,
  saveJob,
  type AgentJob,
  type JournalEntry,
} from "./jobs-store.ts";

import { drive } from "./jobs-run.ts";

export { drive } from "./jobs-run.ts";
export { isFinished } from "./jobs-live.ts";
export type { AgentJob, AgentJobStatus, JobPending, JournalEntry } from "./jobs-store.ts";

export interface StartJobInput {
  backend: AgentBackendId;
  task: string;
  projectId: string;
  cwd: string;
  worktree?: { id: string; branch: string };
  /** The Projector chat that started the job; only that chat continues on completion. */
  origin?: string;
  /** A native session to resume: a retry goes on in the same conversation. */
  sessionId?: string;
  /** The role the job is started with; its snapshot is stored with the job. */
  role?: AgentRoleSnapshot;
  selection?: AgentSelection;
  permissionMode?: AgentPermissionMode;
  unattended?: boolean;
}

export function open(job: AgentJob, journal: JournalEntry[]): Live {
  const entry: Live = {
    job,
    journal,
    abort: new AbortController(),
    waiters: new Set(),
    stopping: false,
    collected: "",
    touched: new Set(),
  };
  live.set(job.id, entry);
  return entry;
}

/** Creates a job and starts its agent without waiting for the answer. */
export async function startJob(input: StartJobInput): Promise<AgentJob> {
  const job: AgentJob = {
    id: newJobId(),
    backend: input.backend,
    task: input.task,
    projectId: input.projectId,
    cwd: input.cwd,
    ...(input.worktree ? { worktree: input.worktree } : {}),
    history: [{ role: "user", content: input.task }],
    ...(input.origin ? { origin: input.origin } : {}),
    messageId: randomUUID(),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.role ? { role: input.role } : {}),
    ...(input.selection ? { selection: input.selection } : {}),
    ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
    unattended: input.unattended === true,
    status: "queued",
    rev: 1,
    createdAt: Date.now(),
    result: "",
    files: [],
    pending: [],
  };
  const entry = open(job, []);
  await persist(entry);
  void drive(entry, false);
  return publicJob(job);
}

/** Rejoins the jobs an earlier server left running; each one is taken over only once. */
export function recoverJobs(): Promise<void> {
  // Two calls at once share one pass: a job that already ended must not be read half-written.
  recovery ??= collect().finally(() => (recovery = undefined));
  return recovery;
}
let recovery: Promise<void> | undefined;

async function collect(): Promise<void> {
  for (const id of await jobIds()) {
    if (live.has(id)) continue;
    const job = await loadJob(id);
    if (!job) continue;
    if (isFinished(job.status)) {
      if (Date.now() - (job.endedAt ?? job.createdAt) > JOB_RETAIN_MS)
        await removeJobFiles(id).catch(() => {});
      continue;
    }
    job.pending = [];
    job.status = "queued";
    // Registered before anything else is awaited: a second recovery must find it taken.
    const entry = open(job, []);
    entry.journal = await loadJournal(id);
    void drive(entry, !!job.runId);
  }
}

export interface JobSummary extends Omit<AgentJob, "result" | "history"> {
  resultPreview: string;
}

const summarize = (job: AgentJob): JobSummary => {
  const { result, history: _history, ...rest } = job;
  return { ...rest, resultPreview: answerPreview(result, 300) };
};

/** The jobs of all projects (or one), newest first, without their journals. */
export async function listJobs(projectId?: string): Promise<JobSummary[]> {
  const jobs = await Promise.all(
    (await jobIds()).map(async (id) => live.get(id)?.job ?? (await loadJob(id))),
  );
  return jobs
    .filter((job): job is AgentJob => !!job && (!projectId || job.projectId === projectId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((job) => summarize(structuredClone(job)));
}

export async function readJob(
  id: string,
): Promise<{ job: AgentJob; journal: JournalEntry[] } | null> {
  const entry = live.get(id);
  if (entry) return { job: publicJob(entry.job), journal: structuredClone(entry.journal) };
  const job = await loadJob(id);
  return job ? { job: publicJob(job), journal: await loadJournal(id) } : null;
}

/** Resolves when the job's `rev` passes `rev`, or after `seconds` (at most 45). */
export async function waitForJob(id: string, rev: number, seconds: number) {
  const entry = live.get(id);
  if (entry && entry.job.rev <= rev && seconds > 0) {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        entry.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, Math.min(seconds, 45) * 1000);
      entry.waiters.add(done);
    });
  }
  return readJob(id);
}

export async function stopJob(id: string): Promise<AgentJob | null> {
  const entry = live.get(id);
  if (!entry) {
    const job = await loadJob(id);
    if (job && !isFinished(job.status)) {
      job.status = "stopped";
      job.rev++;
      job.pending = [];
      job.endedAt = Date.now();
      if (job.runId) {
        await stopRun(job.runId).catch(() => {});
        await removeRun(job.runId).catch(() => {});
      }
      await saveJob(job);
    }
    return job ? publicJob(job) : null;
  }
  entry.stopping = true;
  entry.abort.abort();
  return publicJob(entry.job);
}

export interface JobAnswer {
  /** The request to answer; the first waiting one by default. */
  request?: string;
  /**
   * Permissions only: the user's explicit choice. A job permission is never granted by text or by
   * an agent command — the page shows the card and sends this boolean.
   */
  allow?: boolean;
  always?: boolean;
  /** Questions: the answer in the user's own words. */
  text?: string;
  answers?: Record<string, string[]> | null;
}

/** Sends the user's answer to the request the agent waits on; the run goes on. */
export async function answerJob(id: string, answer: JobAnswer): Promise<AgentJob> {
  const entry = live.get(id);
  if (!entry) throw new Error("Задание не ждёт ответа");
  const card = answer.request
    ? entry.job.pending.find((item) => item.id === answer.request)
    : entry.job.pending[0];
  if (!card) throw new Error("У задания нет запроса, ожидающего ответа");
  let output: unknown;
  let summary: string;
  if (card.kind === "permission") {
    if (typeof answer.allow !== "boolean")
      throw new Error("Разрешение подтверждает пользователь карточкой в чате Projector");
    const allow = answer.allow;
    const always = answer.always === true;
    output = { allow, always: allow && always };
    summary = allow ? (always ? "разрешено всегда" : "разрешено") : "отклонено";
  } else {
    let answers = answer.answers;
    if (answers === undefined) {
      const first = card.questions?.[0];
      const text = answer.text?.trim();
      answers = first && text ? { [first.id]: [text] } : null;
    }
    output = { answers };
    summary = answers ? JSON.stringify(answers) : "пропущено";
  }
  if (!completeCommandRequest(card.id, { output })) {
    dropPending(entry, card.id);
    throw new Error("Запрос уже неактуален");
  }
  record(entry, "answer", { id: card.id, kind: card.kind, summary });
  dropPending(entry, card.id);
  return publicJob(entry.job);
}

export async function removeJob(id: string): Promise<void> {
  const entry = live.get(id);
  if (entry) {
    if (!isFinished(entry.job.status))
      throw new Error("Задание ещё работает: сначала остановите его");
    // A finished job is still live while its final record and journal are written: let that
    // finish, then remove the files, so nothing is deleted halfway or recreated afterwards.
    await entry.finalizing;
  }
  await removeJobFiles(id);
}
