import { HttpError } from "../http/index.ts";
import type {
  Pipeline,
  PipelineDetail,
  PipelineJob,
  PipelineJobDetail,
  PipelineList,
  PipelineStatus,
} from "../../../core/modules/workspace/index.ts";
import { gitlabReader, type GitlabReader } from "./api.ts";
import { nextPage, projectId } from "./browser.ts";
import { gitlabUser, trackerPage, type GitlabUser } from "./trackers.ts";

const PIPELINE_PAGE = 30;
const JOB_PAGE = 100;
const JOB_LIMIT = 300;
const TRACE_LIMIT = 2 * 1024 * 1024;
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
/** GitLab prefixes every trace line with an ISO time and a stream marker (`00O`, `00E`, `00O+`). */
const TRACE_PREFIX = /^\uFEFF?\d{4}-\d{2}-\d{2}T\S+ \d\d[OE][+-]? ?/;
const SECTION_START = /section_start:\d+:([^\r\n]*?)\r?$/;
const SECTION_END = /section_end:\d+:[^\r\n]*\r?$/;

/** GitLab pipeline states that the list endpoint accepts as a filter. */
const FILTER_STATUSES = new Set([
  "created",
  "waiting_for_resource",
  "preparing",
  "pending",
  "running",
  "success",
  "failed",
  "canceled",
  "skipped",
  "manual",
  "scheduled",
]);

const STATUS: Record<string, PipelineStatus> = {
  created: "queued",
  waiting_for_resource: "queued",
  preparing: "queued",
  pending: "queued",
  scheduled: "queued",
  blocked: "queued",
  running: "running",
  success: "success",
  failed: "failed",
  canceled: "canceled",
  skipped: "skipped",
  manual: "manual",
};

export interface ApiPipeline {
  id: number;
  status?: string;
  source?: string;
  ref?: string;
  sha?: string;
  name?: string;
  web_url?: string;
  created_at?: string;
  updated_at?: string;
  duration?: number | null;
  user?: GitlabUser;
}

interface ApiJob {
  id: number;
  status?: string;
  stage?: string;
  name?: string;
  ref?: string;
  web_url?: string;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
  duration?: number | null;
  allow_failure?: boolean;
  failure_reason?: string | null;
  pipeline?: { id?: number };
}

function pipelineStatus(value?: string): PipelineStatus {
  return STATUS[value || ""] ?? "unknown";
}

export function pipeline(raw: ApiPipeline): Pipeline {
  return {
    id: raw.id,
    name: raw.name || "",
    status: pipelineStatus(raw.status),
    source: raw.source || "",
    ref: raw.ref || "",
    sha: raw.sha || "",
    author: gitlabUser(raw.user),
    webUrl: raw.web_url || "",
    createdAt: raw.created_at || "",
    updatedAt: raw.updated_at || "",
    duration: typeof raw.duration === "number" ? raw.duration : null,
  };
}

function job(raw: ApiJob, fallbackPipelineId: number): PipelineJob {
  return {
    id: raw.id,
    pipelineId: raw.pipeline?.id ?? fallbackPipelineId,
    name: raw.name || "",
    stage: raw.stage || "",
    status: pipelineStatus(raw.status),
    ref: raw.ref || "",
    webUrl: raw.web_url || "",
    createdAt: raw.created_at || "",
    startedAt: raw.started_at || "",
    finishedAt: raw.finished_at || "",
    duration: typeof raw.duration === "number" ? raw.duration : null,
    allowFailure: raw.allow_failure === true,
    failureReason: raw.failure_reason || "",
  };
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
  if (!FILTER_STATUSES.has(value)) throw new HttpError(400, "Неизвестный статус пайплайна");
  return value;
}

/** One page of project pipelines, newest id first. */
export async function browseGitlabPipelines(
  repository: string,
  params: Record<string, string> = {},
): Promise<PipelineList> {
  const page = trackerPage(params.page);
  const reader = await gitlabReader(repository);
  const query = new URLSearchParams({
    per_page: String(PIPELINE_PAGE),
    page: String(page),
    order_by: "id",
    sort: "desc",
  });
  const status = statusFilter(params);
  if (status) query.set("status", status);
  if (params.ref) query.set("ref", params.ref);
  const response = await reader.request<ApiPipeline[]>(
    `/projects/${projectId(reader.target.path)}/pipelines?${query}`,
  );
  const rows = Array.isArray(response.data) ? response.data : [];
  return {
    pipelines: rows.map(pipeline),
    next: nextPage(response.headers, page, rows.length, PIPELINE_PAGE),
  };
}

async function pipelineJobs(
  reader: GitlabReader,
  id: string,
  pipeline: number,
): Promise<{ jobs: PipelineJob[]; truncated: boolean }> {
  const jobs: PipelineJob[] = [];
  let page = 1;
  for (;;) {
    const query = new URLSearchParams({ per_page: String(JOB_PAGE), page: String(page) });
    const response = await reader.request<ApiJob[]>(
      `/projects/${id}/pipelines/${pipeline}/jobs?${query}`,
    );
    const rows = Array.isArray(response.data) ? response.data : [];
    for (const row of rows) {
      if (jobs.length >= JOB_LIMIT) return { jobs, truncated: true };
      jobs.push(job(row, pipeline));
    }
    const next = nextPage(response.headers, page, rows.length, JOB_PAGE);
    if (!next) return { jobs, truncated: false };
    if (jobs.length >= JOB_LIMIT) return { jobs, truncated: true };
    page = next;
  }
}

/** Pipeline metadata and every job of the run, up to the reader bound. */
export async function browseGitlabPipeline(
  repository: string,
  value: number | string,
): Promise<PipelineDetail> {
  const number = pipelineId(value);
  const reader = await gitlabReader(repository);
  const id = projectId(reader.target.path);
  const [raw, jobs] = await Promise.all([
    reader.get<ApiPipeline>(`/projects/${id}/pipelines/${number}`),
    pipelineJobs(reader, id, number),
  ]);
  return { pipeline: pipeline(raw), jobs: jobs.jobs, jobsTruncated: jobs.truncated };
}

function cleanTrace(value: string) {
  // GitLab prefixes lines with a timestamp and stream marker, and wraps groups of lines in
  // section markers; show the section name as a plain heading.
  const lines = value.replace(ANSI, "").split("\n");
  const clean: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(TRACE_PREFIX, "").replace(/\r$/, "");
    const start = SECTION_START.exec(line);
    if (start) {
      clean.push(`▶ ${start[1]}`);
      continue;
    }
    if (SECTION_END.test(line)) continue;
    clean.push(line);
  }
  return clean.join("\n");
}

async function traceText(response: Response): Promise<{ log: string; truncated: boolean }> {
  const body = response.body;
  if (!body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    const truncated = bytes.length > TRACE_LIMIT;
    return {
      log: cleanTrace(bytes.subarray(0, TRACE_LIMIT).toString("utf8")),
      truncated,
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
    if (size + chunk.length > TRACE_LIMIT) {
      chunks.push(chunk.subarray(0, TRACE_LIMIT - size));
      size = TRACE_LIMIT;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(chunk);
    size += chunk.length;
  }
  return { log: cleanTrace(Buffer.concat(chunks).toString("utf8")), truncated };
}

/** A job without a trace (old, erased or forbidden) still opens with an empty log. */
async function jobTrace(
  reader: GitlabReader,
  id: string,
  traceOf: number,
): Promise<{ log: string; truncated: boolean }> {
  try {
    const response = await reader.fetch(`/projects/${id}/jobs/${traceOf}/trace`, {
      headers: { Accept: "text/plain" },
    });
    return await traceText(response);
  } catch (error) {
    const anonymous = !reader.target.token;
    if (
      error instanceof HttpError &&
      ([403, 404].includes(error.status) || (anonymous && error.status === 401))
    )
      return { log: "", truncated: false };
    throw error;
  }
}

async function jobMetadata(reader: GitlabReader, id: string, number: number): Promise<ApiJob> {
  try {
    return await reader.get<ApiJob>(`/projects/${id}/jobs/${number}`);
  } catch (error) {
    // Public projects expose pipelines anonymously, but GitLab hides single jobs behind a login.
    if (!reader.target.token && error instanceof HttpError && error.status === 401)
      throw new HttpError(401, "Джоб GitLab доступен только после входа в интеграцию");
    throw error;
  }
}

/** Job metadata and readonly trace, capped by both bytes and host availability. */
export async function browseGitlabJob(
  repository: string,
  value: number | string,
): Promise<PipelineJobDetail> {
  const number = jobId(value);
  const reader = await gitlabReader(repository);
  const id = projectId(reader.target.path);
  const [raw, trace] = await Promise.all([
    jobMetadata(reader, id, number),
    jobTrace(reader, id, number),
  ]);
  return {
    job: job(raw, raw.pipeline?.id ?? 0),
    log: trace.log,
    logTruncated: trace.truncated,
  };
}
