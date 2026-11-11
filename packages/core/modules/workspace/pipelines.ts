import type { IssueUser } from "./contract.ts";

/** Host-neutral CI status: GitLab statuses and GitHub conclusions map into this set. */
export type PipelineStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "canceled"
  | "skipped"
  | "manual"
  | "unknown";
export interface Pipeline {
  id: number;
  /** Display name of a workflow; empty when the host names runs only by id. */
  name: string;
  /** Human title of the run (GitHub `display_title`); empty when the host has none. */
  title: string;
  /** Sequential number on the host (GitHub `run_number`, GitLab `iid`); 0 when unknown. */
  number: number;
  /** Attempt of this run; 1 when the host has no retries. */
  attempt: number;
  /** Workflow / CI config path; empty when unknown. */
  path: string;
  /** First line of the head commit message; empty when unknown. */
  commitMessage: string;
  /** Pull or merge request numbers that started this run. */
  pulls: number[];
  status: PipelineStatus;
  /** What started the run: a GitLab source (`push`, `web`, …) or a GitHub event. */
  source: string;
  ref: string;
  sha: string;
  author: IssueUser;
  webUrl: string;
  createdAt: string;
  updatedAt: string;
  /** Seconds reported by the host, or null while it has not finished. */
  duration: number | null;
}
export type PipelineAnnotationLevel = "failure" | "warning" | "notice";
export interface PipelineAnnotation {
  path: string;
  startLine: number | null;
  endLine: number | null;
  level: PipelineAnnotationLevel;
  title: string;
  message: string;
}
export interface PipelineJobStep {
  name: string;
  status: PipelineStatus;
  number: number;
  startedAt: string;
  finishedAt: string;
  duration: number | null;
}
export interface PipelineUsage {
  /** Runner OS or host group (`Ubuntu`, `Windows`, …). */
  label: string;
  /** Billable milliseconds reported by the host. */
  milliseconds: number;
}
export interface PipelineJob {
  id: number;
  pipelineId: number;
  name: string;
  stage: string;
  status: PipelineStatus;
  ref: string;
  webUrl: string;
  createdAt: string;
  startedAt: string;
  finishedAt: string;
  /** Seconds reported by the host, or null while it has not finished. */
  duration: number | null;
  allowFailure: boolean;
  failureReason: string;
  /** Runner labels (GitHub `windows-latest`) or GitLab tags. */
  labels: string[];
  /** Runner name when the host reports one. */
  runner: string;
  steps: PipelineJobStep[];
}
export interface PipelineList {
  pipelines: Pipeline[];
  /** Page number of the next page, or null when the list is complete. */
  next: number | null;
}
export interface PipelineDetail {
  pipeline: Pipeline;
  jobs: PipelineJob[];
  /** The host returned more jobs than the reader loads at once. */
  jobsTruncated: boolean;
  annotations: PipelineAnnotation[];
  annotationsTruncated: boolean;
  usage: PipelineUsage[];
}
export interface PipelineJobDetail {
  job: PipelineJob;
  log: string;
  /** The trace is longer than the reader loads or was not available. */
  logTruncated: boolean;
  annotations: PipelineAnnotation[];
  annotationsTruncated: boolean;
}
