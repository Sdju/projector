import { HttpError } from "../http/index.ts";
import type {
  Pipeline,
  PipelineAnnotation,
  PipelineAnnotationLevel,
  PipelineJob,
  PipelineJobStep,
  PipelineStatus,
  PipelineUsage,
} from "@ai-projector/core/modules/workspace/index.ts";
import { user, type RemoteUser } from "./issues.ts";

export const ANNOTATION_PAGE = 50;
const ANNOTATION_JOBS = 8;

/** Run and job states GitHub reports before a conclusion exists. */
const STATUSES: Record<string, PipelineStatus> = {
  queued: "queued",
  requested: "queued",
  waiting: "queued",
  pending: "queued",
  in_progress: "running",
  completed: "unknown",
  startup_failure: "failed",
  action_required: "manual",
  neutral: "success",
  stale: "skipped",
};

const CONCLUSIONS: Record<string, PipelineStatus> = {
  success: "success",
  failure: "failed",
  timed_out: "failed",
  startup_failure: "failed",
  cancelled: "canceled",
  skipped: "skipped",
  action_required: "manual",
  neutral: "success",
  stale: "skipped",
};

const USAGE_OS: Record<string, string> = {
  UBUNTU: "Ubuntu",
  WINDOWS: "Windows",
  MACOS: "macOS",
};

export interface ApiWorkflowRun {
  id: number;
  name?: string | null;
  display_title?: string | null;
  path?: string | null;
  run_number?: number;
  run_attempt?: number;
  status?: string;
  conclusion?: string | null;
  event?: string;
  head_branch?: string | null;
  head_sha?: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  run_started_at?: string;
  actor?: RemoteUser;
  head_commit?: { message?: string | null } | null;
  pull_requests?: Array<{ number?: number }>;
}

interface ApiStep {
  name?: string;
  status?: string;
  conclusion?: string | null;
  number?: number;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface ApiWorkflowJob {
  id: number;
  run_id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  head_branch?: string | null;
  html_url?: string;
  started_at?: string | null;
  completed_at?: string | null;
  labels?: string[];
  runner_name?: string | null;
  steps?: ApiStep[];
}

interface ApiAnnotation {
  path?: string;
  start_line?: number | null;
  end_line?: number | null;
  annotation_level?: string;
  title?: string | null;
  message?: string | null;
}

export interface ApiTiming {
  billable?: Record<string, { total_ms?: number }>;
}

export type GithubGet = <T>(path: string) => Promise<T>;

function pipelineStatus(status?: string, conclusion?: string | null): PipelineStatus {
  if (status === "completed" || !status) return CONCLUSIONS[conclusion || ""] ?? "unknown";
  return STATUSES[status] ?? CONCLUSIONS[status] ?? "unknown";
}

function secondsBetween(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return Math.round((to - from) / 1000);
}

function firstLine(value?: string | null) {
  return (value || "").trim().split(/\r?\n/, 1)[0] || "";
}

function positiveInt(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function optionalLine(value: unknown): number | null {
  return positiveInt(value) || null;
}

function pullNumbers(raw: ApiWorkflowRun): number[] {
  const seen = new Set<number>();
  const pulls: number[] = [];
  for (const item of raw.pull_requests ?? []) {
    const number = positiveInt(item.number);
    if (!number || seen.has(number)) continue;
    seen.add(number);
    pulls.push(number);
  }
  return pulls;
}

export function pipeline(raw: ApiWorkflowRun): Pipeline {
  const status = pipelineStatus(raw.status, raw.conclusion);
  return {
    id: positiveInt(raw.id),
    name: raw.name || "",
    title: (raw.display_title || "").trim(),
    number: positiveInt(raw.run_number),
    attempt: positiveInt(raw.run_attempt, 1),
    path: raw.path || "",
    commitMessage: firstLine(raw.head_commit?.message),
    pulls: pullNumbers(raw),
    status,
    source: raw.event || "",
    ref: raw.head_branch || "",
    sha: raw.head_sha || "",
    author: user(raw.actor),
    webUrl: raw.html_url || "",
    createdAt: raw.created_at || "",
    updatedAt: raw.updated_at || "",
    duration:
      status === "running" || status === "queued"
        ? null
        : secondsBetween(raw.run_started_at || raw.created_at, raw.updated_at),
  };
}

function failureReason(raw: ApiWorkflowJob): string {
  const step = (raw.steps ?? []).find(
    (item) => item.conclusion === "failure" || item.conclusion === "timed_out",
  );
  if (step?.name) return step.name;
  if (["failure", "timed_out", "startup_failure"].includes(raw.conclusion || ""))
    return raw.conclusion || "";
  return "";
}

function step(raw: ApiStep): PipelineJobStep {
  const status = pipelineStatus(raw.status, raw.conclusion);
  return {
    name: raw.name || "",
    status,
    number: positiveInt(raw.number),
    startedAt: raw.started_at || "",
    finishedAt: raw.completed_at || "",
    duration:
      status === "running" || status === "queued"
        ? null
        : secondsBetween(raw.started_at, raw.completed_at),
  };
}

function annotationLevel(value?: string): PipelineAnnotationLevel {
  if (value === "warning" || value === "notice") return value;
  return "failure";
}

function annotation(raw: ApiAnnotation): PipelineAnnotation | null {
  const message = (raw.message || "").trim();
  const path = raw.path || "";
  if (!message && !path) return null;
  return {
    path,
    startLine: optionalLine(raw.start_line),
    endLine: optionalLine(raw.end_line),
    level: annotationLevel(raw.annotation_level),
    title: (raw.title || "").trim(),
    message,
  };
}

export function job(raw: ApiWorkflowJob, fallbackPipelineId: number, ref = ""): PipelineJob {
  const status = pipelineStatus(raw.status, raw.conclusion);
  return {
    id: positiveInt(raw.id),
    pipelineId: positiveInt(raw.run_id) || fallbackPipelineId,
    name: raw.name || "",
    // Actions runs have no stages: every job is a peer of the same run.
    stage: "",
    status,
    ref: raw.head_branch || ref,
    webUrl: raw.html_url || "",
    createdAt: raw.started_at || "",
    startedAt: raw.started_at || "",
    finishedAt: raw.completed_at || "",
    duration:
      status === "running" || status === "queued"
        ? null
        : secondsBetween(raw.started_at, raw.completed_at),
    allowFailure: false,
    failureReason: failureReason(raw),
    labels: (raw.labels ?? []).filter((label) => !!label),
    runner: raw.runner_name || "",
    steps: (raw.steps ?? []).map(step),
  };
}

/** Optional extras (annotations, timing) must not fail the whole run. */
export async function optionalGet<T>(get: GithubGet, path: string): Promise<T | null> {
  try {
    return await get<T>(path);
  } catch (error) {
    if (error instanceof HttpError) return null;
    throw error;
  }
}

export async function jobAnnotations(
  get: GithubGet,
  jobId: number,
): Promise<{ items: PipelineAnnotation[]; truncated: boolean }> {
  const rows = await optionalGet<ApiAnnotation[]>(
    get,
    `/check-runs/${jobId}/annotations?per_page=${ANNOTATION_PAGE}`,
  );
  const list = Array.isArray(rows) ? rows : [];
  return {
    items: list.flatMap((item) => {
      const mapped = annotation(item);
      return mapped ? [mapped] : [];
    }),
    truncated: list.length === ANNOTATION_PAGE,
  };
}

export async function collectAnnotations(
  get: GithubGet,
  jobs: PipelineJob[],
): Promise<{ items: PipelineAnnotation[]; truncated: boolean }> {
  const failed = jobs.filter((item) => item.status === "failed");
  const targets = failed.slice(0, ANNOTATION_JOBS);
  const pages = await Promise.all(targets.map((item) => jobAnnotations(get, item.id)));
  return {
    items: pages.flatMap((page) => page.items),
    truncated: failed.length > targets.length || pages.some((page) => page.truncated),
  };
}

export function usage(raw: ApiTiming | null): PipelineUsage[] {
  if (!raw?.billable) return [];
  return Object.entries(raw.billable).flatMap(([os, value]) => {
    const milliseconds = value?.total_ms;
    if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds) || milliseconds <= 0)
      return [];
    return [{ label: USAGE_OS[os] ?? os, milliseconds }];
  });
}
