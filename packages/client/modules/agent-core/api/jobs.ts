import type { AgentBackendId } from "../model/types.ts";
import type { AgentRoleSnapshot } from "@projector-ai/core/modules/agent-role/index.ts";

export type AgentJobStatus = "queued" | "running" | "needs-user" | "done" | "error" | "stopped";

/** A request of the agent that waits for the user. */
export interface AgentJobPending {
  id: string;
  kind: "permission" | "question";
  title: string;
  tool?: string;
  detail?: string;
  persistent?: boolean;
  questions?: {
    id: string;
    question: string;
    header?: string;
    options: { id: string; label: string; description?: string }[];
    multiple: boolean;
    custom?: boolean;
    optional?: boolean;
  }[];
  custom?: boolean;
}

/** A background job as the server describes it. */
export interface AgentJobView {
  id: string;
  backend: AgentBackendId;
  task: string;
  projectId: string;
  cwd: string;
  worktree?: { id: string; branch: string };
  /** The isolated copy was merged, discarded or transferred to a retry. */
  worktreeCleared?: boolean;
  /** The Projector chat that started the job, when it did. */
  origin?: string;
  /** The role the job started with; the snapshot stays with the job. */
  role?: AgentRoleSnapshot;
  unattended: boolean;
  status: AgentJobStatus;
  rev: number;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  sessionId?: string;
  error?: string;
  files: string[];
  pending: AgentJobPending[];
  /** The full answer; the list carries `resultPreview` instead. */
  result?: string;
  resultPreview?: string;
}

export interface AgentJobEntry {
  at: number;
  event: string;
  data: unknown;
}

export const jobFinished = (status: AgentJobStatus) =>
  status === "done" || status === "error" || status === "stopped";

async function call<T>(url: string, init?: RequestInit, failure = "Запрос не удался"): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || failure);
  return data as T;
}

const post = (url: string, body: unknown = {}, failure?: string) =>
  call<{ job: AgentJobView }>(url, { method: "POST", body: JSON.stringify(body) }, failure);

export async function fetchJobs(projectId?: string): Promise<AgentJobView[]> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return (await call<{ jobs: AgentJobView[] }>(`/api/agent/jobs${query}`)).jobs;
}

/** One job with its journal; with `wait` the server holds the answer until `rev` changes. */
export function fetchJob(id: string, wait = 0, rev = 0, signal?: AbortSignal) {
  const query = wait ? `?wait=${wait}&rev=${rev}` : "";
  return call<{ job: AgentJobView; journal: AgentJobEntry[] }>(
    `/api/agent/jobs/${id}${query}`,
    { signal },
    "Не удалось прочитать задание",
  );
}

export interface StartJobOptions {
  projectId: string;
  /** The agent; with a role the server takes the role's agent and checks it. */
  backend?: AgentBackendId;
  /** A chat role: its agent, selection and permission mode become the job's snapshot. */
  role?: string;
  task: string;
  isolate?: boolean;
  mode?: string;
  unattended?: boolean;
  /** The Projector chat that starts the job; its completion continues that conversation. */
  origin?: string;
}

export async function startJob(options: StartJobOptions): Promise<AgentJobView> {
  return (await post("/api/agent/jobs", options, "Не удалось запустить задание")).job;
}

export async function stopJob(id: string): Promise<AgentJobView> {
  return (await post(`/api/agent/jobs/${id}/stop`, {}, "Не удалось остановить задание")).job;
}

export interface JobAnswerBody {
  request?: string;
  allow?: boolean;
  always?: boolean;
  text?: string;
  answers?: Record<string, string[]> | null;
}

export interface AgentJobDiff {
  files: string[];
  stat: string;
  patch: string;
  truncated: boolean;
}

/** What a job changed in its folder: changed paths, `--stat` and a unified patch. */
export async function fetchJobDiff(id: string, limit = 0): Promise<AgentJobDiff> {
  const query = limit ? `?limit=${encodeURIComponent(limit)}` : "";
  return (
    await call<{ diff: AgentJobDiff }>(
      `/api/agent/jobs/${id}/diff${query}`,
      undefined,
      "Не удалось прочитать изменения задания",
    )
  ).diff;
}

export async function answerJob(id: string, body: JobAnswerBody): Promise<AgentJobView> {
  return (await post(`/api/agent/jobs/${id}/answer`, body, "Не удалось передать ответ")).job;
}

export interface JobWorktreeStatus {
  id: string;
  branch: string;
  changed: number;
}

/** The isolated copy of a job and how many files differ; null when the job works in the project. */
export async function fetchJobWorktree(id: string): Promise<JobWorktreeStatus | null> {
  return (
    await call<{ worktree: JobWorktreeStatus | null }>(
      `/api/agent/jobs/${id}/worktree`,
      undefined,
      "Не удалось прочитать копию задания",
    )
  ).worktree;
}

export interface JobWorktreeResult {
  merged?: boolean;
  message?: string;
  discarded?: boolean;
  job?: AgentJobView;
}

export async function mergeJobWorktree(id: string): Promise<JobWorktreeResult> {
  return call<JobWorktreeResult>(
    `/api/agent/jobs/${id}/worktree/merge`,
    { method: "POST" },
    "Не удалось влить копию задания",
  );
}

export async function discardJobWorktree(id: string): Promise<JobWorktreeResult> {
  return call<JobWorktreeResult>(
    `/api/agent/jobs/${id}/worktree/discard`,
    { method: "POST" },
    "Не удалось удалить копию задания",
  );
}

export async function retryJob(id: string, task?: string, append = false): Promise<AgentJobView> {
  return (
    await call<{ job: AgentJobView }>(
      `/api/agent/jobs/${id}/retry`,
      { method: "POST", body: JSON.stringify({ task, append }) },
      "Не удалось повторить задание",
    )
  ).job;
}

/** Adds a follow-up to a running job; a finished one starts a new run in the same record. */
export async function sendJobMessage(
  id: string,
  text: string,
): Promise<{ accepted: boolean; continued: boolean; job?: AgentJobView }> {
  return call<{ accepted: boolean; continued: boolean; job?: AgentJobView }>(
    `/api/agent/jobs/${id}/send`,
    { method: "POST", body: JSON.stringify({ text }) },
    "Не удалось отправить уточнение заданию",
  );
}

/** Starts a new job in a copy that begins from the finished job's current state. */
export async function forkJob(id: string, task?: string): Promise<AgentJobView> {
  return (
    await call<{ job: AgentJobView }>(
      `/api/agent/jobs/${id}/fork`,
      { method: "POST", body: JSON.stringify({ task }) },
      "Не удалось создать форк задания",
    )
  ).job;
}

export async function removeJob(id: string): Promise<void> {
  await call(`/api/agent/jobs/${id}`, { method: "DELETE" }, "Не удалось убрать задание");
}
