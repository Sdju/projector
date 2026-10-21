import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "../../../core/modules/app-paths/index.ts";
import type { AgentBackendId, AgentPermissionMode } from "./backend.ts";
import type { AgentSelection } from "./controls.ts";

export type AgentJobStatus = "queued" | "running" | "needs-user" | "done" | "error" | "stopped";

/** A request of the agent that waits for the user: the card shown in the job and answered by id. */
export interface JobPending {
  id: string;
  kind: "permission" | "question";
  title: string;
  detail?: string;
  /** Permission: the backend can remember the decision. */
  persistent?: boolean;
  /** Question: what is asked and the options offered. */
  questions?: {
    id: string;
    question: string;
    header?: string;
    options: { id: string; label: string; description?: string }[];
    multiple: boolean;
  }[];
}

export interface AgentJob {
  id: string;
  backend: AgentBackendId;
  task: string;
  projectId: string;
  /** The folder the agent works in: the project or its isolated copy. */
  cwd: string;
  worktree?: { id: string; branch: string };
  selection?: AgentSelection;
  permissionMode?: AgentPermissionMode;
  /** The user explicitly chose no questions: permissions are granted and questions skipped. */
  unattended: boolean;
  status: AgentJobStatus;
  /** Grows with every change, so a long poll can tell something happened. */
  rev: number;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  runId?: string;
  sessionId?: string;
  result: string;
  error?: string;
  files: string[];
  pending: JobPending[];
}

/** One event of the job as the chat stream carried it (`text`, `tool`, ...), plus `answer`/`status`. */
export interface JournalEntry {
  at: number;
  event: string;
  data: unknown;
}

export const JOB_ID = /^[0-9a-f]{12}$/;
/** Finished jobs are kept this long. */
export const JOB_RETAIN_MS = 14 * 24 * 60 * 60 * 1000;
export const JOURNAL_LIMIT = 1500;

const jobsRoot = () => join(dataDir(), "agent", "jobs");

/** The directory of a job; the identifier comes from a client, so its shape is checked. */
export function jobDirectory(id: string): string {
  if (!JOB_ID.test(id)) throw new Error("Некорректный идентификатор задания");
  return join(jobsRoot(), id);
}

export const newJobId = () => randomBytes(6).toString("hex");

async function writeAtomic(file: string, data: unknown): Promise<void> {
  const temporary = `${file}.${randomBytes(3).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
  await rename(temporary, file);
}

export async function saveJob(job: AgentJob): Promise<void> {
  const dir = jobDirectory(job.id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeAtomic(join(dir, "job.json"), job);
}

export async function saveJournal(id: string, journal: JournalEntry[]): Promise<void> {
  const dir = jobDirectory(id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeAtomic(join(dir, "journal.json"), journal);
}

export async function loadJob(id: string): Promise<AgentJob | null> {
  try {
    return JSON.parse(await readFile(join(jobDirectory(id), "job.json"), "utf8"));
  } catch {
    return null;
  }
}

export async function loadJournal(id: string): Promise<JournalEntry[]> {
  try {
    return JSON.parse(await readFile(join(jobDirectory(id), "journal.json"), "utf8"));
  } catch {
    return [];
  }
}

export async function jobIds(): Promise<string[]> {
  return (await readdir(jobsRoot()).catch(() => [] as string[])).filter((id) => JOB_ID.test(id));
}

export async function removeJobFiles(id: string): Promise<void> {
  await rm(jobDirectory(id), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
