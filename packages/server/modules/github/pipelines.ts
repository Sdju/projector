import { HttpError } from "../http/index.ts";
import { integrationConfig } from "../integration-store/index.ts";
import type {
  PipelineDetail,
  PipelineJobDetail,
  PipelineList,
} from "@ai-projector/core/modules/workspace/index.ts";
import { githubResponse, repositoryName } from "./api.ts";
import { githubReader } from "./browser.ts";
import {
  collectAnnotations,
  job,
  jobAnnotations,
  optionalGet,
  pipeline,
  usage,
  type ApiTiming,
  type ApiWorkflowJob,
  type ApiWorkflowRun,
} from "./pipeline-map.ts";

export { pipeline } from "./pipeline-map.ts";

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
  const [raw, jobs, timing] = await Promise.all([
    get<ApiWorkflowRun>(`/actions/runs/${number}`),
    pipelineJobs(get, number),
    optionalGet<ApiTiming>(get, `/actions/runs/${number}/timing`),
  ]);
  const ref = raw.head_branch || "";
  const mapped = jobs.jobs.map((item) => job(item, number, ref));
  const notes = await collectAnnotations(get, mapped);
  return {
    pipeline: pipeline(raw),
    jobs: mapped,
    jobsTruncated: jobs.truncated,
    annotations: notes.items,
    annotationsTruncated: notes.truncated,
    usage: usage(timing),
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
  const [raw, response, notes] = await Promise.all([
    get<ApiWorkflowJob>(`/actions/jobs/${number}`),
    jobLogResponse(repository, number),
    jobAnnotations(get, number),
  ]);
  const trace = response ? await cappedLog(response) : { log: "", truncated: false };
  return {
    job: job(raw, raw.run_id ?? 0),
    log: trace.log,
    logTruncated: trace.truncated,
    annotations: notes.items,
    annotationsTruncated: notes.truncated,
  };
}
