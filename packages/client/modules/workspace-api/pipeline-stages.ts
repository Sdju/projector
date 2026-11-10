import type { PipelineJob, PipelineStatus } from "@projector-ai/core/modules/workspace/index.ts";
import { PIPELINE_STATUS_LABEL } from "@projector-ai/core/modules/workspace/index.ts";
import { countRu } from "../../common/utilities/plural.ts";

/** Jobs that make a stage (and the whole pipeline) look broken. */
export const PIPELINE_PROBLEM_STATUSES = new Set<PipelineStatus>(["failed", "canceled"]);

const SUMMARY_ORDER: PipelineStatus[] = [
  "failed",
  "canceled",
  "running",
  "queued",
  "manual",
  "success",
  "skipped",
  "unknown",
];

export type PipelineStageTone = "danger" | "warning" | "success" | "muted";

export interface PipelineStageGroup {
  stage: string;
  jobs: PipelineJob[];
  count: string;
  total: number;
  done: number;
  problems: PipelineJob[];
  running: PipelineJob[];
  visible: PipelineJob[];
  hidden: number;
  summary: string[];
  tone: PipelineStageTone;
}

/**
 * Groups jobs by stage. GitLab allocates job ids in reverse stage order, so the earliest id
 * in a stage defines the stage order.
 */
export function groupPipelineStages(
  jobs: PipelineJob[],
  options: { problemsOnly?: boolean } = {},
): PipelineStageGroup[] {
  const stages = new Map<string, { jobs: PipelineJob[]; first: number }>();
  for (const job of jobs) {
    if (options.problemsOnly && !PIPELINE_PROBLEM_STATUSES.has(job.status)) continue;
    const stage = job.stage || "без стадии";
    const entry = stages.get(stage) ?? { jobs: [], first: job.id };
    entry.jobs.push(job);
    entry.first = Math.min(entry.first, job.id);
    stages.set(stage, entry);
  }
  return [...stages.entries()]
    .sort(([, left], [, right]) => left.first - right.first)
    .map(([stage, { jobs: stageJobs }]) => {
      const counts = new Map<PipelineStatus, number>();
      for (const job of stageJobs) counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
      const problems = stageJobs.filter((job) => PIPELINE_PROBLEM_STATUSES.has(job.status));
      const running = stageJobs.filter((job) => job.status === "running");
      const visible = problems.length ? problems.slice(0, 5) : running.slice(0, 1);
      return {
        stage,
        jobs: stageJobs,
        count: countRu(stageJobs.length, "джоб", "джоба", "джобов"),
        total: stageJobs.length,
        done: stageJobs.filter((job) => !["queued", "running", "manual"].includes(job.status))
          .length,
        problems,
        running,
        visible,
        hidden: problems.length + running.length - visible.length,
        summary: SUMMARY_ORDER.flatMap((status) => {
          const count = counts.get(status);
          return count ? [`${count} ${PIPELINE_STATUS_LABEL[status]}`] : [];
        }),
        tone: problems.length
          ? ("danger" as const)
          : running.length
            ? ("warning" as const)
            : stageJobs.every((job) => job.status === "success")
              ? ("success" as const)
              : ("muted" as const),
      };
    });
}
