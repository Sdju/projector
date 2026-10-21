import type { AgentBackendId } from "../model/types.ts";

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
  backend: AgentBackendId;
  task: string;
  isolate?: boolean;
  mode?: string;
  unattended?: boolean;
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

export async function answerJob(id: string, body: JobAnswerBody): Promise<AgentJobView> {
  return (await post(`/api/agent/jobs/${id}/answer`, body, "Не удалось передать ответ")).job;
}

export async function removeJob(id: string): Promise<void> {
  await call(`/api/agent/jobs/${id}`, { method: "DELETE" }, "Не удалось убрать задание");
}
