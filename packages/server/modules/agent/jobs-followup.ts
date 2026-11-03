import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import type { AgentHistoryTurn } from "../providers/index.ts";
import { change, live, persist, record } from "./jobs-live.ts";
import { drive, isFinished, open, readJob } from "./jobs.ts";
import { loadJob, publicJob, type AgentJob } from "./jobs-store.ts";
import { holdJobWorktree } from "./jobs-worktree.ts";

/** A finished job is being reopened right now: a second follow-up must not race it. */
const resuming = new Set<string>();

/** Continues a finished job in the same record, copy and native session. */
export async function followUpJob(id: string, text: string): Promise<AgentJob | null> {
  const message = text.trim();
  if (!message) throw new Error("Напишите уточнение агенту");
  const active = live.get(id);
  if ((active && !isFinished(active.job.status)) || resuming.has(id))
    throw new Error("Задание ещё работает: уточнение уйдёт в текущий ход");
  if (active?.finalizing) await active.finalizing;
  if (live.has(id)) throw new Error("Задание ещё работает: уточнение уйдёт в текущий ход");
  resuming.add(id);
  let release: (() => void) | undefined;
  try {
    const initial = await readJob(id);
    if (!initial) return null;
    if (initial.job.worktreeCleared)
      throw new Error("Копия задания удалена или передана другому заданию");
    if (initial.job.worktree) release = holdJobWorktree(initial.job.worktree.id);
    const found = await readJob(id);
    if (!found) return null;
    const { job, journal } = found;
    if (!isFinished(job.status))
      throw new Error("Задание ещё работает: уточнение уйдёт в текущий ход");
    if (!(await stat(job.cwd).catch(() => null))?.isDirectory())
      throw new Error("Папка задания не найдена");
    const previous = job.result;
    const stored = live.get(id)?.job ?? (await loadJob(id));
    const history: AgentHistoryTurn[] = stored?.history?.length
      ? structuredClone(stored.history)
      : [
          { role: "user", content: job.task },
          { role: "assistant", content: previous.slice(0, 20_000) },
        ];
    if (history.at(-1)?.role === "user")
      history.push({ role: "assistant", content: previous.slice(0, 20_000) });
    job.history = [...history, { role: "user", content: message }];
    job.result = "";
    delete job.error;
    delete job.endedAt;
    job.pending = [];
    job.messageId = randomUUID();
    const entry = open(job, journal);
    record(entry, "input", { text: message, followUp: true });
    change(entry, "running");
    await persist(entry);
    void drive(entry, false, message, job.sessionId ? [] : history);
    return publicJob(job);
  } finally {
    release?.();
    resuming.delete(id);
  }
}
