import { randomUUID } from "node:crypto";
import type { MediaJob, MediaJobStatus } from "@ai-projector/core/modules/media/index.ts";

export interface MediaJobRecord extends MediaJob {
  /** Идентификатор задачи у провайдера; не отдаётся клиенту. */
  upstreamId?: string;
}

const TERMINAL_TTL_MS = 60 * 60 * 1000;
const globalState = globalThis as typeof globalThis & {
  projectorMediaJobs?: Map<string, MediaJobRecord>;
  projectorMediaOperations?: Map<string, { poll?: Promise<MediaJob>; cancel?: Promise<MediaJob> }>;
};
const jobs = (): Map<string, MediaJobRecord> => (globalState.projectorMediaJobs ??= new Map());

function prune(): void {
  const now = Date.now();
  for (const [id, job] of jobs()) {
    const terminal =
      job.status === "succeeded" || job.status === "failed" || job.status === "cancelled";
    if (terminal && now - job.updatedAt > TERMINAL_TTL_MS) jobs().delete(id);
  }
}

export function createMediaJob(
  input: Omit<MediaJobRecord, "id" | "createdAt" | "updatedAt">,
): MediaJobRecord {
  prune();
  const now = Date.now();
  const record: MediaJobRecord = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
  jobs().set(record.id, record);
  return record;
}

export function mediaJobRecord(id: string): MediaJobRecord | undefined {
  prune();
  return jobs().get(id);
}

export function updateMediaJob(
  id: string,
  patch: Partial<
    Pick<MediaJobRecord, "status" | "artifacts" | "progress" | "error" | "upstreamId">
  >,
): MediaJobRecord | undefined {
  const existing = jobs().get(id);
  if (!existing) return undefined;
  if (
    isTerminalMediaStatus(existing.status) &&
    patch.status !== undefined &&
    patch.status !== existing.status
  )
    return existing;
  const next: MediaJobRecord = { ...existing, ...patch, updatedAt: Date.now() };
  jobs().set(id, next);
  return next;
}

export function publicMediaJob(record: MediaJobRecord): MediaJob {
  const { upstreamId: _upstreamId, ...job } = record;
  return job;
}

/** Тестовый сброс HMR-состояния. */
export function resetMediaJobs(): void {
  jobs().clear();
  globalState.projectorMediaOperations?.clear();
}

export function isTerminalMediaStatus(status: MediaJobStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}
