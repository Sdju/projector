/** Human labels and formatting shared by the trajectory panel and its ledger. */

import type { TrajectoryRecordKind, TrajectoryRecordStatus } from "./types.ts";

const KIND_LABELS: Record<TrajectoryRecordKind, string> = {
  user: "Запрос",
  assistant: "Ответ",
  thought: "Размышление",
  tool: "Инструмент",
  subtool: "Вложенный вызов",
  task: "Задача",
  note: "Заметка",
  judge: "Судья",
  context: "Контекст",
  system: "Система",
  compaction: "Сжатие",
};

const KIND_SHORT: Record<TrajectoryRecordKind, string> = {
  user: "вы",
  assistant: "агент",
  thought: "мысль",
  tool: "вызов",
  subtool: "суб",
  task: "задача",
  note: "заметка",
  judge: "судья",
  context: "контекст",
  system: "система",
  compaction: "сжатие",
};

const STATUS_LABELS: Record<TrajectoryRecordStatus, string> = {
  running: "Идёт",
  done: "Готово",
  error: "Ошибка",
  stopped: "Остановлено",
};

export function kindLabel(kind: TrajectoryRecordKind): string {
  return KIND_LABELS[kind];
}

export function kindShort(kind: TrajectoryRecordKind): string {
  return KIND_SHORT[kind];
}

export function statusLabel(status: TrajectoryRecordStatus | undefined): string {
  return status ? STATUS_LABELS[status] : "";
}

/** A duration as a compact label: milliseconds while short, then seconds and minutes. */
export function formatDuration(milliseconds: number | undefined): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return "";
  const ms = Math.max(0, milliseconds);
  if (ms < 1_000) return `${Math.round(ms)} мс`;
  if (ms < 10_000) return `${(ms / 1_000).toFixed(1).replace(".", ",")} с`;
  if (ms < 60_000) return `${Math.round(ms / 1_000)} с`;
  const total = Math.floor(ms / 1_000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, "0")}`;
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Clock time of a record; a date is added when the record is not from today. */
export function formatClock(timestamp: number | undefined): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const time = date.toLocaleTimeString("ru", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return sameDay
    ? time
    : `${date.toLocaleDateString("ru", { day: "2-digit", month: "2-digit" })} ${time}`;
}

const tokenFormat = new Intl.NumberFormat("ru", { maximumFractionDigits: 1 });

/** A token count in a compact form: 12 400 → 12,4 тыс. */
export function formatTokens(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "";
  if (value < 1_000) return tokenFormat.format(value);
  if (value < 1_000_000) return `${tokenFormat.format(value / 1_000)} тыс.`;
  return `${tokenFormat.format(value / 1_000_000)} млн`;
}

/** A price in the provider's own currency, without inventing a currency symbol. */
export function formatCost(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("ru", {
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}
