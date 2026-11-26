import { kindLabel } from "./labels.ts";
import type {
  TrajectoryRecord,
  TrajectoryRecordKind,
  TrajectoryRecordStatus,
  TrajectoryUsage,
  TrajectoryContext,
  TrajectoryTool,
  TrajectoryTask,
  TrajectoryTiming,
} from "./types.ts";

const KINDS = new Set<TrajectoryRecordKind>([
  "user",
  "assistant",
  "thought",
  "tool",
  "subtool",
  "task",
  "note",
  "judge",
  "context",
  "system",
  "compaction",
]);
export const STATUSES = new Set<TrajectoryRecordStatus>(["running", "done", "error", "stopped"]);

type JsonObject = Record<string, unknown>;

export const objectOf = (value: unknown): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
export const stringOf = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
export const nonEmpty = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value : fallback;
export const numberOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const booleanOf = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;
export function usageOf(value: unknown): TrajectoryUsage | undefined {
  const raw = objectOf(value);
  if (!raw) return undefined;
  const usage: TrajectoryUsage = {};
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "cost"] as const) {
    const number = numberOf(raw[key]);
    if (number !== undefined) usage[key] = number;
  }
  return Object.keys(usage).length ? usage : undefined;
}

export function contextOf(value: unknown): TrajectoryContext | undefined {
  const raw = objectOf(value);
  if (!raw) return undefined;
  const used = numberOf(raw.used);
  const size = numberOf(raw.size);
  if (used === undefined || size === undefined) return undefined;
  return {
    used,
    size,
    ...(typeof raw.model === "string" ? { model: raw.model } : {}),
  };
}

function toolOf(value: unknown): TrajectoryTool | undefined {
  const raw = objectOf(value);
  if (!raw) return undefined;
  const id = stringOf(raw.id);
  const name = stringOf(raw.name);
  if (!id || !name) return undefined;
  const status = STATUSES.has(raw.status as TrajectoryRecordStatus)
    ? (raw.status as TrajectoryRecordStatus)
    : "done";
  const tool: TrajectoryTool = { id, name, status, detail: stringOf(raw.detail) };
  for (const key of ["input", "output", "kind", "label", "parent"] as const) {
    if (typeof raw[key] === "string") tool[key] = raw[key] as string;
  }
  if (Array.isArray(raw.paths))
    tool.paths = raw.paths.filter((path): path is string => typeof path === "string");
  for (const key of ["startedAt", "endedAt"] as const) {
    const number = numberOf(raw[key]);
    if (number !== undefined) tool[key] = number;
  }
  return tool;
}

function taskOf(value: unknown): TrajectoryTask | undefined {
  const raw = objectOf(value);
  if (!raw) return undefined;
  const id = stringOf(raw.id);
  if (!id) return undefined;
  const kind = raw.kind === "agent" || raw.kind === "shell" ? raw.kind : "other";
  const status =
    raw.status === "running" ||
    raw.status === "done" ||
    raw.status === "error" ||
    raw.status === "stopped"
      ? raw.status
      : "done";
  const task: TrajectoryTask = {
    id,
    kind,
    status,
    title: nonEmpty(raw.title, kind === "agent" ? "Субагент" : "Задача"),
  };
  for (const key of [
    "subagent",
    "model",
    "session",
    "tool",
    "prompt",
    "summary",
    "lastTool",
  ] as const) {
    if (typeof raw[key] === "string") task[key] = raw[key] as string;
  }
  for (const key of ["background"] as const) {
    const value = booleanOf(raw[key]);
    if (value !== undefined) task[key] = value;
  }
  for (const key of ["tools", "tokens", "startedAt", "endedAt"] as const) {
    const value = numberOf(raw[key]);
    if (value !== undefined) task[key] = value;
  }
  if (Array.isArray(raw.log))
    task.log = raw.log.filter((line): line is string => typeof line === "string");
  return task;
}

function timingOf(value: unknown): TrajectoryTiming | undefined {
  const raw = objectOf(value);
  if (!raw) return undefined;
  const ttftMs = numberOf(raw.ttftMs);
  const decodingMs = numberOf(raw.decodingMs);
  if (ttftMs === undefined && decodingMs === undefined) return undefined;
  return {
    ...(ttftMs === undefined ? {} : { ttftMs }),
    ...(decodingMs === undefined ? {} : { decodingMs }),
  };
}

function metaOf(value: unknown): TrajectoryRecord["meta"] {
  const raw = objectOf(value);
  if (!raw) return undefined;
  const meta: NonNullable<TrajectoryRecord["meta"]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value))
      meta[key] = value as string | number | boolean | null;
    else if (value !== undefined) meta[key] = JSON.stringify(value);
  }
  return Object.keys(meta).length ? meta : undefined;
}

export function recordOf(value: unknown, index: number): TrajectoryRecord {
  const raw = objectOf(value) ?? {};
  const kind = KINDS.has(raw.kind as TrajectoryRecordKind)
    ? (raw.kind as TrajectoryRecordKind)
    : "note";
  const status = STATUSES.has(raw.status as TrajectoryRecordStatus)
    ? (raw.status as TrajectoryRecordStatus)
    : undefined;
  const record: TrajectoryRecord = {
    id: nonEmpty(raw.id, `record:${index}`),
    kind,
    turn: Math.max(0, Math.floor(numberOf(raw.turn) ?? 0)),
    title: nonEmpty(raw.title, kindLabel(kind)),
    ...(status ? { status } : {}),
  };
  for (const key of ["text", "detail", "input", "output", "parentId", "callId"] as const) {
    if (typeof raw[key] === "string") record[key] = raw[key] as string;
  }
  for (const key of ["startedAt", "endedAt", "durationMs"] as const) {
    const number = numberOf(raw[key]);
    if (number !== undefined) record[key] = number;
  }
  if (booleanOf(raw.approximate) === true) record.approximate = true;
  const tool = toolOf(raw.tool);
  if (tool) record.tool = tool;
  const task = taskOf(raw.task);
  if (task) record.task = task;
  const usage = usageOf(raw.usage);
  if (usage) record.usage = usage;
  const timing = timingOf(raw.timing);
  if (timing) record.timing = timing;
  const meta = metaOf(raw.meta);
  if (meta) record.meta = meta;
  return record;
}
