import type { PipelineStatus } from "../../../../../../core/modules/workspace/index.ts";

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
