import {
  createApprovalBridge,
  createQuestionBridge,
  completeCommandRequest,
} from "./command-bridge.ts";
import { createRun, readRun, removeRun, stopRun, trackRun } from "./agent-runs.ts";
import type { AgentRunRecord } from "./agent-runs.ts";
import type { AgentBackendId, AgentEventName, AgentPermissionMode } from "./backend.ts";
import type { AgentSelection } from "./controls.ts";
import { changedSince, snapshotGit } from "./jobs-files.ts";
import {
  MAX_RUNNING_JOBS,
  RESULT_LIMIT,
  change,
  dropPending,
  flushJournal,
  isFinished,
  live,
  onEvent,
  persist,
  record,
  wake,
  type Live,
} from "./jobs-live.ts";
import {
  JOB_RETAIN_MS,
  jobIds,
  loadJob,
  loadJournal,
  newJobId,
  removeJobFiles,
  saveJob,
  type AgentJob,
  type AgentJobStatus,
  type JournalEntry,
} from "./jobs-store.ts";
import { runAgent } from "./registry.ts";

export { MAX_RUNNING_JOBS, isFinished } from "./jobs-live.ts";
export type { AgentJob, AgentJobStatus, JobPending, JournalEntry } from "./jobs-store.ts";

/** A request nobody answered is refused after this long. */
const ANSWER_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export interface StartJobInput {
  backend: AgentBackendId;
  task: string;
  projectId: string;
  cwd: string;
  worktree?: { id: string; branch: string };
  selection?: AgentSelection;
  permissionMode?: AgentPermissionMode;
  unattended?: boolean;
}

/** Throws when the limit of working jobs is reached; asked before an isolated copy is made. */
export function assertJobSlot(): void {
  if (live.size >= MAX_RUNNING_JOBS)
    throw new Error(
      `Уже работает ${MAX_RUNNING_JOBS} фоновых задания: дождитесь или остановите одно`,
    );
}

const clip = (text: string) => (text.length > RESULT_LIMIT ? text.slice(0, RESULT_LIMIT) : text);

async function finish(entry: Live): Promise<void> {
  const { job } = entry;
  const status: AgentJobStatus = entry.stopping ? "stopped" : entry.failure ? "error" : "done";
  job.result = clip((entry.final ?? entry.collected).trim());
  if (entry.failure && !entry.stopping) job.error = entry.failure;
  job.pending = [];
  const changed = await changedSince(job.cwd, entry.snapshot);
  job.files = [...new Set([...changed, ...entry.touched])].sort().slice(0, 500);
  job.endedAt = Date.now();
  if (job.runId) await removeRun(job.runId).catch(() => {});
  change(entry, status);
  await persist(entry);
  await flushJournal(entry);
  live.delete(job.id);
  wake(entry);
}

async function drive(entry: Live, attach: boolean): Promise<void> {
  const { job } = entry;
  let untrack: (() => void) | undefined;
  try {
    let run: AgentRunRecord | null;
    if (attach) {
      run = job.runId ? await readRun(job.runId) : null;
      if (!run) throw new Error("Ход задания потерян при перезапуске сервера");
    } else {
      run = {
        backend: job.backend,
        message: job.task,
        history: [],
        cwd: job.cwd,
        selection: job.selection,
        permissionMode: job.permissionMode,
        approvals: true,
        projectId: job.projectId,
        chat: `job:${job.id}`,
      };
      job.runId = await createRun(run);
      job.startedAt = Date.now();
      entry.snapshot = await snapshotGit(job.cwd);
    }
    untrack = trackRun(job.runId!, () => entry.abort.abort());
    change(entry, "running");
    const emit = (event: AgentEventName, data: unknown) => onEvent(entry, event, data);
    await runAgent({
      ...run,
      backend: job.backend,
      run: { id: job.runId!, attach },
      approve: async (request) => {
        if (job.unattended) {
          record(entry, "answer", { auto: true, tool: request.tool, title: request.title });
          return true;
        }
        let id = "";
        const bridge = createApprovalBridge(
          (name, data) => {
            id = String((data as { id?: unknown }).id ?? "");
            emit(name, data);
          },
          entry.abort.signal,
          ANSWER_TIMEOUT_MS,
        );
        try {
          return await bridge(request);
        } catch {
          return false;
        } finally {
          if (id) dropPending(entry, id);
        }
      },
      ask: async (request) => {
        if (job.unattended) return null;
        let id = "";
        const bridge = createQuestionBridge(
          (name, data) => {
            id = String((data as { id?: unknown }).id ?? "");
            emit(name, data);
          },
          entry.abort.signal,
          ANSWER_TIMEOUT_MS,
        );
        try {
          return await bridge(request);
        } catch {
          return null;
        } finally {
          if (id) dropPending(entry, id);
        }
      },
      abort: entry.abort.signal,
      emit,
    });
  } catch (error) {
    if (!entry.stopping) entry.failure = error instanceof Error ? error.message : "Ошибка агента";
  } finally {
    untrack?.();
  }
  if (entry.stopping && job.runId) await stopRun(job.runId).catch(() => {});
  await finish(entry);
}

function open(job: AgentJob, journal: JournalEntry[]): Live {
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
  assertJobSlot();
  const job: AgentJob = {
    id: newJobId(),
    backend: input.backend,
    task: input.task,
    projectId: input.projectId,
    cwd: input.cwd,
    ...(input.worktree ? { worktree: input.worktree } : {}),
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
  return structuredClone(job);
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

export interface JobSummary extends Omit<AgentJob, "result"> {
  resultPreview: string;
}

const summarize = (job: AgentJob): JobSummary => {
  const { result, ...rest } = job;
  return { ...rest, resultPreview: result.slice(0, 300) };
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
  if (entry) return { job: structuredClone(entry.job), journal: structuredClone(entry.journal) };
  const job = await loadJob(id);
  return job ? { job, journal: await loadJournal(id) } : null;
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
    return job;
  }
  entry.stopping = true;
  entry.abort.abort();
  return structuredClone(entry.job);
}

export interface JobAnswer {
  /** The request to answer; the first waiting one by default. */
  request?: string;
  allow?: boolean;
  always?: boolean;
  /** Free words: "да"/"нет" for a permission, the answer for the first question. */
  text?: string;
  answers?: Record<string, string[]> | null;
}

const YES = /^(да|yes|y|allow|разреш|ok|ок|одобр|always)/i;

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
    const text = answer.text?.trim() ?? "";
    const allow = answer.allow ?? (text ? YES.test(text) : false);
    const always = answer.always ?? /^(always|всегда)/i.test(text);
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
  return structuredClone(entry.job);
}

export async function removeJob(id: string): Promise<void> {
  if (live.has(id)) throw new Error("Задание ещё работает: сначала остановите его");
  await removeJobFiles(id);
}
