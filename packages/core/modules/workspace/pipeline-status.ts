import type { PipelineAnnotationLevel, PipelineStatus } from "./pipelines.ts";

export const PIPELINE_STATUS_LABEL: Record<PipelineStatus, string> = {
  queued: "в очереди",
  running: "идёт",
  success: "успешно",
  failed: "ошибка",
  canceled: "отменён",
  skipped: "пропущен",
  manual: "вручную",
  unknown: "неизвестно",
};

export type PipelineTone = "success" | "danger" | "warning" | "muted" | "faint";

export const PIPELINE_STATUS_TONE: Record<PipelineStatus, PipelineTone> = {
  queued: "muted",
  running: "warning",
  success: "success",
  failed: "danger",
  canceled: "faint",
  skipped: "faint",
  manual: "warning",
  unknown: "faint",
};

export const PIPELINE_ANNOTATION_LEVEL_LABEL: Record<PipelineAnnotationLevel, string> = {
  failure: "ошибка",
  warning: "предупреждение",
  notice: "заметка",
};

export const PIPELINE_ANNOTATION_LEVEL_TONE: Record<
  PipelineAnnotationLevel,
  "danger" | "warning" | "info"
> = {
  failure: "danger",
  warning: "warning",
  notice: "info",
};

/** Seconds as a compact duration: `42 с`, `3 мин 07 с`, `1 ч 12 мин`. */
export function durationLabel(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  if (total < 60) return `${total} с`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60)
    return rest ? `${minutes} мин ${String(rest).padStart(2, "0")} с` : `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours} ч ${restMinutes} мин` : `${hours} ч`;
}

const SOURCE_LABEL: Record<string, string> = {
  push: "push",
  web: "веб",
  api: "API",
  trigger: "триггер",
  schedule: "расписание",
  pipeline: "pipeline",
  parent_pipeline: "родительский pipeline",
  merge_request_event: "MR",
  external: "внешний",
  chat: "чат",
  webide: "Web IDE",
  ondemand_dast_scan: "DAST-сканирование",
  ondemand_dast_validation: "проверка DAST",
  pull_request: "PR",
  pull_request_target: "PR",
  merge_group: "merge queue",
  workflow_dispatch: "вручную",
  workflow_run: "workflow",
  repository_dispatch: "API",
  release: "релиз",
  deployment: "деплой",
  deployment_status: "деплой",
  issue_comment: "комментарий",
  discussion: "discussion",
};

/** Host event of a CI run as a short human label; unknown sources stay as reported. */
export function sourceLabel(source: string) {
  if (!source) return "";
  return SOURCE_LABEL[source] ?? source;
}

/**
 * A branch or MR ref without GitLab's internal prefix: `refs/merge-requests/12/merge` is `!12`,
 * `refs/heads/main` is `main`. Other refs keep their shape minus `refs/`.
 */
export function refLabel(ref: string) {
  const value = ref.trim();
  const mergeRequest = /^refs\/merge-requests\/(\d+)\/(.+)$/.exec(value);
  if (mergeRequest) {
    const kind = mergeRequest[2];
    return kind === "merge" || kind === "head"
      ? `!${mergeRequest[1]}`
      : `!${mergeRequest[1]} ${kind}`;
  }
  if (value.startsWith("refs/heads/")) return value.slice("refs/heads/".length);
  if (value.startsWith("refs/tags/")) return value.slice("refs/tags/".length);
  return value.replace(/^refs\//, "");
}
