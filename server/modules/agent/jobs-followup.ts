import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import type { AgentHistoryTurn } from "../providers/index.ts";
import { change, live, persist, record } from "./jobs-live.ts";
import { drive, isFinished, open, readJob } from "./jobs.ts";
import type { AgentJob } from "./jobs-store.ts";

/** A finished job is being reopened right now: a second follow-up must not race it. */
const resuming = new Set<string>();

/** Continues a finished job in the same record, copy and native session. */
export async function followUpJob(id: string, text: string): Promise<AgentJob | null> {
  const message = text.trim();
  if (!message) throw new Error("Напишите уточнение агенту");
  if (live.has(id) || resuming.has(id))
    throw new Error("Задание ещё работает: уточнение уйдёт в текущий ход");
  resuming.add(id);
  try {
    const found = await readJob(id);
    if (!found) return null;
    const { job, journal } = found;
    if (!isFinished(job.status))
      throw new Error("Задание ещё работает: уточнение уйдёт в текущий ход");
    if (!(await stat(job.cwd).catch(() => null))?.isDirectory())
      throw new Error("Папка задания не найдена");
    const previous = job.result;
    job.result = "";
    delete job.error;
    delete job.endedAt;
    job.pending = [];
    job.messageId = randomUUID();
    const entry = open(job, journal);
    record(entry, "input", { text: message, followUp: true });
    change(entry, "running");
    await persist(entry);
    const history: AgentHistoryTurn[] = job.sessionId
      ? []
      : [
          { role: "user", content: job.task },
          { role: "assistant", content: previous.slice(0, 20_000) },
        ];
    void drive(entry, false, message, history);
    return structuredClone(job);
  } finally {
    resuming.delete(id);
  }
}
