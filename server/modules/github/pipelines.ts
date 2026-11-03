import { HttpError } from "../http/index.ts";
import { integrationConfig } from "../integration-store/index.ts";
import type {
  Pipeline,
  PipelineDetail,
  PipelineJob,
  PipelineJobDetail,
  PipelineList,
  PipelineStatus,
} from "../../../core/modules/workspace/index.ts";
import { githubResponse, repositoryName } from "./api.ts";
import { githubReader } from "./browser.ts";
import { user, type RemoteUser } from "./issues.ts";

const PIPELINE_PAGE = 30;
const JOB_PAGE = 100;
const JOB_LIMIT = 300;
const LOG_LIMIT = 2 * 1024 * 1024;
const ESCAPE = String.fromCharCode(27);
const ANSI = new RegExp(`${ESCAPE}\\[[0-9;?]*[ -/]*[@-~]`, "g");

/** Filters of the sidebar mapped to the status values GitHub Actions accepts. */
const FILTERS: Record<string, string> = {
  running: "in_progress",
  failed: "failure",
  success: "success",
  canceled: "cancelled",
  queued: "queued",
  skipped: "skipped",
  manual: "action_required",
};

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

export interface ApiWorkflowRun {
  id: number;
  name?: string | null;
  display_title?: string | null;
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
}

interface ApiStep {
  name?: string;
  status?: string;
  conclusion?: string | null;
}

interface ApiWorkflowJob {
  id: number;
  run_id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  head_branch?: string | null;
  html_url?: string;
  started_at?: string | null;
  completed_at?: string | null;
  steps?: ApiStep[];
}

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

export function pipeline(raw: ApiWorkflowRun): Pipeline {
  const status = pipelineStatus(raw.status, raw.conclusion);
  return {
    id: raw.id,
    name: raw.name || "",
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

function job(raw: ApiWorkflowJob, fallbackPipelineId: number, ref = ""): PipelineJob {
  const status = pipelineStatus(raw.status, raw.conclusion);
  return {
    id: raw.id,
    pipelineId: raw.run_id ?? fallbackPipelineId,
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
  };
}

function pageNumber(value?: string | number): number {
  const page = Number(value || 1);
  if (!Number.isSafeInteger(page) || page < 1) throw new HttpError(400, "Неверная страница");
  return page;
}

function pipelineId(value: number | string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "Укажите номер пайплайна");
  return id;
}

function jobId(value: number | string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "Укажите номер джоба");
  return id;
}

function statusFilter(params: Record<string, string>): string {
  const value = (params.status || "").trim();
  if (!value || value === "all") return "";
  const status = FILTERS[value];
  if (!status) throw new HttpError(400, "Неизвестный статус пайплайна");
  return status;
}

/** One page of workflow runs, newest first. */
export async function browseGithubPipelines(
  repository: string,
  params: Record<string, string> = {},
): Promise<PipelineList> {
  const page = pageNumber(params.page);
  const get = await githubReader(repository);
  const query = new URLSearchParams({ per_page: String(PIPELINE_PAGE), page: String(page) });
  const status = statusFilter(params);
  if (status) query.set("status", status);
  if (params.ref) query.set("branch", params.ref);
  const response = await get<{ workflow_runs?: ApiWorkflowRun[] }>(`/actions/runs?${query}`);
  const rows = Array.isArray(response.workflow_runs) ? response.workflow_runs : [];
  return {
    pipelines: rows.map(pipeline),
    next: rows.length === PIPELINE_PAGE ? page + 1 : null,
  };
}

async function pipelineJobs(
  get: <T>(path: string) => Promise<T>,
  pipeline: number,
): Promise<{ jobs: ApiWorkflowJob[]; truncated: boolean }> {
  const jobs: ApiWorkflowJob[] = [];
  let page = 1;
  for (;;) {
    const query = new URLSearchParams({
      per_page: String(JOB_PAGE),
      page: String(page),
      filter: "latest",
    });
    const response = await get<{ jobs?: ApiWorkflowJob[] }>(
      `/actions/runs/${pipeline}/jobs?${query}`,
    );
    const rows = Array.isArray(response.jobs) ? response.jobs : [];
    for (const row of rows) {
      if (jobs.length >= JOB_LIMIT) return { jobs, truncated: true };
      jobs.push(row);
    }
    if (rows.length < JOB_PAGE) return { jobs, truncated: false };
    page++;
  }
}

/** Workflow run metadata and every job of the latest attempt, up to the reader bound. */
export async function browseGithubPipeline(
  repository: string,
  value: number | string,
): Promise<PipelineDetail> {
  const number = pipelineId(value);
  const get = await githubReader(repository);
  const raw = await get<ApiWorkflowRun>(`/actions/runs/${number}`);
  const jobs = await pipelineJobs(get, number);
  const ref = raw.head_branch || "";
  return {
    pipeline: pipeline(raw),
    jobs: jobs.jobs.map((item) => job(item, number, ref)),
    jobsTruncated: jobs.truncated,
  };
}

async function githubToken() {
  const config = await integrationConfig("github");
  return config.enabled ? config.credentials.token || "" : "";
}

/** GitHub answers with a signed storage link; the token must not follow it to another host. */
async function jobLogResponse(repository: string, job: number): Promise<Response | null> {
  const name = repositoryName(repository);
  const token = await githubToken();
  const response = await githubResponse(`/repos/${name}/actions/jobs/${job}/logs`, token, {
    redirect: "manual",
  });
  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400 && location) {
    const signed = new URL(location, "https://api.github.com");
    if (signed.protocol !== "https:") return null;
    const log = await fetch(signed, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
    return [403, 404, 410].includes(log.status) ? null : log;
  }
  // Logs of old runs expire; a private repository without a token answers 404 as well.
  if ([403, 404, 410].includes(response.status)) return null;
  if (response.status === 401)
    throw new HttpError(401, "Авторизация GitHub истекла. Войдите снова");
  if (!response.ok) throw new HttpError(400, `GitHub вернул ${response.status} при чтении лога`);
  return response;
}

/** The trace is capped by bytes; the rest is reported as truncated. */
async function cappedLog(response: Response): Promise<{ log: string; truncated: boolean }> {
  const body = response.body;
  if (!body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      log: cleanLog(bytes.subarray(0, LOG_LIMIT).toString("utf8")),
      truncated: bytes.length > LOG_LIMIT,
    };
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    if (size + chunk.length > LOG_LIMIT) {
      chunks.push(chunk.subarray(0, LOG_LIMIT - size));
      size = LOG_LIMIT;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(chunk);
    size += chunk.length;
  }
  return { log: cleanLog(Buffer.concat(chunks).toString("utf8")), truncated };
}

function cleanLog(value: string) {
  return value
    .replace(ANSI, "")
    .replace(/^\uFEFF/, "")
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .join("\n");
}

/** Job metadata and readonly log, capped by both bytes and host availability. */
export async function browseGithubJob(
  repository: string,
  value: number | string,
): Promise<PipelineJobDetail> {
  const number = jobId(value);
  const get = await githubReader(repository);
  const [raw, response] = await Promise.all([
    get<ApiWorkflowJob>(`/actions/jobs/${number}`),
    jobLogResponse(repository, number),
  ]);
  const trace = response ? await cappedLog(response) : { log: "", truncated: false };
  return {
    job: job(raw, raw.run_id ?? 0),
    log: trace.log,
    logTruncated: trace.truncated,
  };
}
