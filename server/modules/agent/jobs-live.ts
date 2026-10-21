import type { AgentQuestion } from "./command-bridge.ts";
import type { AgentEventName } from "./backend.ts";
import { pathsOfCall, type GitSnapshot } from "./jobs-files.ts";
import {
  JOURNAL_LIMIT,
  saveJob,
  saveJournal,
  type AgentJob,
  type AgentJobStatus,
  type JobPending,
  type JournalEntry,
} from "./jobs-store.ts";

const CLIP = 4000;
const SAVE_DELAY_MS = 400;

/** How many jobs may work at the same time. */
export const MAX_RUNNING_JOBS = 4;
/** The full answer kept with a job. */
export const RESULT_LIMIT = 100_000;

const TERMINAL = new Set<AgentJobStatus>(["done", "error", "stopped"]);
export const isFinished = (status: AgentJobStatus) => TERMINAL.has(status);

/** A job this server drives right now. The registry lives on `globalThis`: a hot reload keeps it. */
export interface Live {
  job: AgentJob;
  journal: JournalEntry[];
  abort: AbortController;
  waiters: Set<() => void>;
  stopping: boolean;
  failure?: string;
  final?: string;
  collected: string;
  snapshot?: GitSnapshot;
  touched: Set<string>;
  saveTimer?: ReturnType<typeof setTimeout>;
}

const host = globalThis as typeof globalThis & { projectorAgentJobs?: Map<string, Live> };
export const live = (host.projectorAgentJobs ??= new Map<string, Live>());

/** Big tool inputs and outputs are cut: the journal shows what happened, not every byte. */
export function shrink(value: unknown): unknown {
  if (typeof value === "string") return value.length > CLIP ? `${value.slice(0, CLIP)}…` : value;
  if (value == null || typeof value !== "object") return value;
  try {
    const text = JSON.stringify(value);
    return text.length > CLIP ? `${text.slice(0, CLIP)}…` : value;
  } catch {
    return "";
  }
}

export function wake(entry: Live): void {
  for (const waiter of [...entry.waiters]) waiter();
}

/** Writes the record now; the journal is written soon after, once per burst of events. */
export async function persist(entry: Live): Promise<void> {
  await saveJob(entry.job).catch(() => {});
}
export function persistJournalLater(entry: Live): void {
  if (entry.saveTimer) return;
  entry.saveTimer = setTimeout(() => {
    entry.saveTimer = undefined;
    void saveJournal(entry.job.id, entry.journal).catch(() => {});
  }, SAVE_DELAY_MS);
  entry.saveTimer.unref();
}
export async function flushJournal(entry: Live): Promise<void> {
  clearTimeout(entry.saveTimer);
  entry.saveTimer = undefined;
  await saveJournal(entry.job.id, entry.journal).catch(() => {});
}

export function record(entry: Live, event: string, data: unknown): void {
  const at = Date.now();
  const last = entry.journal.at(-1);
  const text = (data as { text?: unknown } | undefined)?.text;
  if ((event === "text" || event === "thought") && typeof text === "string") {
    const lastText = (last?.data as { text?: string } | undefined)?.text;
    if (last?.event === event && lastText !== undefined) {
      (last.data as { text: string }).text = lastText + text;
      last.at = at;
      persistJournalLater(entry);
      return;
    }
  }
  entry.journal.push({ at, event, data });
  if (entry.journal.length > JOURNAL_LIMIT)
    entry.journal.splice(0, entry.journal.length - JOURNAL_LIMIT);
  persistJournalLater(entry);
}

export function change(entry: Live, status: AgentJobStatus): void {
  const { job } = entry;
  if (job.status === status) return;
  job.status = status;
  job.rev++;
  record(entry, "status", { status });
  void persist(entry);
  wake(entry);
}

/** Back to `running` when nothing waits for the user any more. */
export function settle(entry: Live): void {
  if (entry.job.status === "needs-user" && !entry.job.pending.length) change(entry, "running");
}

export function addPending(entry: Live, card: JobPending): void {
  entry.job.pending.push(card);
  entry.job.rev++;
  if (entry.job.status === "running") change(entry, "needs-user");
  else {
    void persist(entry);
    wake(entry);
  }
}

export function dropPending(entry: Live, id: string): void {
  const before = entry.job.pending.length;
  entry.job.pending = entry.job.pending.filter((card) => card.id !== id);
  if (entry.job.pending.length === before) return;
  entry.job.rev++;
  void persist(entry);
  wake(entry);
  settle(entry);
}

/** Folds one event of the agent into the job: the journal, the answer, the cards that wait. */
export function onEvent(entry: Live, event: AgentEventName, data: unknown): void {
  const { job } = entry;
  const body = (data ?? {}) as Record<string, unknown>;
  switch (event) {
    case "text":
      if (typeof body.text === "string") entry.collected += body.text;
      record(entry, event, { text: body.text });
      return;
    case "thought":
      record(entry, event, { text: body.text });
      return;
    case "session": {
      if (typeof body.id === "string") job.sessionId = body.id;
      job.rev++;
      void persist(entry);
      return;
    }
    case "tool": {
      const name = String(body.name ?? "");
      for (const path of pathsOfCall(name, body.input, job.cwd)) entry.touched.add(path);
      record(entry, event, { ...body, input: shrink(body.input) });
      return;
    }
    case "tool-result":
      record(entry, event, { ...body, output: shrink(body.output) });
      return;
    case "task":
      record(entry, event, body);
      return;
    case "permission-request": {
      const id = String(body.id ?? "");
      record(entry, event, { ...body, input: shrink(body.input) });
      addPending(entry, {
        id,
        kind: "permission",
        tool: String(body.tool ?? ""),
        title: String(body.title || body.tool || "Разрешение"),
        detail: typeof body.detail === "string" ? body.detail : undefined,
        persistent: body.persistent === true,
      });
      return;
    }
    case "question-request": {
      const id = String(body.id ?? "");
      const questions = Array.isArray(body.questions) ? (body.questions as AgentQuestion[]) : [];
      record(entry, event, body);
      addPending(entry, {
        id,
        kind: "question",
        title: typeof body.title === "string" && body.title ? body.title : "Вопрос агента",
        questions: questions.map((item) => ({
          id: item.id,
          question: item.question,
          header: item.header,
          options: item.options ?? [],
          multiple: item.multiple === true,
          custom: item.custom,
          optional: item.optional,
        })),
        custom: body.custom === true,
      });
      return;
    }
    case "done":
      if (typeof body.text === "string" && body.text) entry.final = body.text;
      return;
    case "error":
      entry.failure = String(body.error ?? "Ошибка агента");
      return;
    default:
      return;
  }
}
