import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { writeFileAtomic } from "../atomic-files/index.ts";
import { jobsChanged } from "./change-events.ts";
import { isAgentHistoryTurn } from "./run-record.ts";
import {
  isCount,
  isRecord,
  isText,
  optionalField,
  readStateFile,
  type ParsedState,
} from "./state-file.ts";
import type { AgentBackendId, AgentPermissionMode } from "./backend.ts";
import type { AgentSelection } from "./controls.ts";
import type { JudgeVerdict } from "@ai-projector/core/modules/agent-judge/index.ts";
import type { AgentRoleSnapshot } from "@ai-projector/core/modules/agent-role/index.ts";
import type { AgentHistoryTurn } from "../providers/index.ts";

export type AgentJobStatus = "queued" | "running" | "needs-user" | "done" | "error" | "stopped";

/** A request of the agent that waits for the user: the card shown in the job and answered by id. */
export interface JobPending {
  id: string;
  kind: "permission" | "question";
  title: string;
  /** Permission: the tool asking. */
  tool?: string;
  detail?: string;
  /** Permission: the backend can remember the decision. */
  persistent?: boolean;
  /** Permission: Projector Judge's verdict, when evaluated. */
  judge?: JudgeVerdict;
  /** Question: what is asked and the options offered. */
  questions?: {
    id: string;
    question: string;
    header?: string;
    options: { id: string; label: string; description?: string }[];
    multiple: boolean;
    custom?: boolean;
    optional?: boolean;
  }[];
  /** Question: the user may write an answer of their own. */
  custom?: boolean;
}

export interface AgentJob {
  id: string;
  backend: AgentBackendId;
  task: string;
  projectId: string;
  /** The folder the agent works in: the project or its isolated copy. */
  cwd: string;
  worktree?: { id: string; branch: string };
  /** The old copy is gone or belongs to a retry: this record cannot use its folder any more. */
  worktreeCleared?: boolean;
  /** HEAD when the job started and the paths already dirty: what `job.diff` compares against. */
  base?: string;
  dirty?: string[];
  /** Completed turns plus the user message of an active run, for agents without a native session. */
  history?: AgentHistoryTurn[];
  /** The Projector chat that started the job: its completion continues that conversation. */
  origin?: string;
  /** The chat role the job started with; the job keeps its snapshot for retries and forks. */
  role?: AgentRoleSnapshot;
  selection?: AgentSelection;
  permissionMode?: AgentPermissionMode;
  /** The message id the backend keeps for this job; a follow-up written mid-run is delivered to it. */
  messageId: string;
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

/** The replay history is server-only: API polls carry the current result instead. */
export function publicJob(job: AgentJob): AgentJob {
  const copy = structuredClone(job);
  delete copy.history;
  return copy;
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

const JOB_STATUSES: readonly AgentJobStatus[] = [
  "queued",
  "running",
  "needs-user",
  "done",
  "error",
  "stopped",
];
const isJobStatus = (value: unknown): value is AgentJobStatus =>
  JOB_STATUSES.includes(value as AgentJobStatus);
const isTextList = (value: unknown): boolean => Array.isArray(value) && value.every(isText);

/**
 * Проверяет запись `job.json`. Файл описывает одно задание, поэтому негодная запись означает
 * испорченный файл целиком: применить её частично нельзя. Обязательны поля, без которых задание
 * не показать и не продолжить после перезапуска; необязательные проверяются, только если есть.
 * `messageId` в их числе: записи, сделанные до его появления, должны читаться.
 */
function parseJob(id: string, value: unknown): ParsedState<AgentJob> | undefined {
  if (!isRecord(value) || value.id !== id) return;
  if (!isText(value.backend) || !value.backend) return;
  if (!isText(value.task) || !isText(value.projectId) || !isText(value.cwd)) return;
  if (typeof value.unattended !== "boolean") return;
  if (!isJobStatus(value.status)) return;
  if (!isCount(value.rev) || !isCount(value.createdAt) || !isText(value.result)) return;
  if (!isTextList(value.files) || !Array.isArray(value.pending)) return;
  if (
    !optionalField(
      value,
      "history",
      (item) => Array.isArray(item) && item.every(isAgentHistoryTurn),
    )
  )
    return;
  for (const key of ["worktree", "role", "selection"] as const)
    if (!optionalField(value, key, isRecord)) return;
  for (const key of ["messageId", "error", "runId", "sessionId", "base", "origin"] as const)
    if (!optionalField(value, key, isText)) return;
  if (!optionalField(value, "dirty", isTextList)) return;
  for (const key of ["startedAt", "endedAt"] as const)
    if (!optionalField(value, key, isCount)) return;
  if (!optionalField(value, "worktreeCleared", (item) => typeof item === "boolean")) return;
  return { value: value as unknown as AgentJob };
}

/**
 * Журнал — история показа хода: негодную запись можно безопасно выбросить, не теряя остальные,
 * поэтому неверный элемент не делает файл повреждённым.
 */
function parseJournal(value: unknown): ParsedState<JournalEntry[]> | undefined {
  if (!Array.isArray(value)) return;
  const entries = value.filter(isJournalEntry);
  return { value: entries, dropped: value.length - entries.length };
}

const isJournalEntry = (value: unknown): value is JournalEntry =>
  isRecord(value) && isCount(value.at) && isText(value.event) && "data" in value;

function writeAtomic(file: string, data: unknown): Promise<void> {
  return writeFileAtomic(file, JSON.stringify(data));
}

export async function saveJob(job: AgentJob): Promise<void> {
  const dir = jobDirectory(job.id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeAtomic(join(dir, "job.json"), job);
  jobsChanged();
}

export async function saveJournal(id: string, journal: JournalEntry[]): Promise<void> {
  const dir = jobDirectory(id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeAtomic(join(dir, "journal.json"), journal);
}

export async function loadJob(id: string): Promise<AgentJob | null> {
  // Идентификатор приходит от клиента: негодный — это отсутствующее задание, а не ошибка.
  if (!JOB_ID.test(id)) return null;
  const read = await readStateFile(join(jobDirectory(id), "job.json"), "Файл задания", (value) =>
    parseJob(id, value),
  );
  return read.status === "ok" ? read.value : null;
}

export async function loadJournal(id: string): Promise<JournalEntry[]> {
  if (!JOB_ID.test(id)) return [];
  const read = await readStateFile(
    join(jobDirectory(id), "journal.json"),
    "Журнал задания",
    parseJournal,
  );
  return read.status === "ok" ? read.value : [];
}

export async function jobIds(): Promise<string[]> {
  return (await readdir(jobsRoot()).catch(() => [] as string[])).filter((id) => JOB_ID.test(id));
}

export async function removeJobFiles(id: string): Promise<void> {
  await rm(jobDirectory(id), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  jobsChanged();
}
