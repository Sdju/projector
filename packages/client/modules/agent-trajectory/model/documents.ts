/** The trajectory document format, its normalizer, and the in-memory documents a tab or panel reads. */

import { nextDocumentId } from "./document-id.ts";
import { kindLabel } from "./labels.ts";
import { trajectoryFromTurns } from "./trajectory.ts";
import type {
  TrajectoryCapabilities,
  TrajectoryContext,
  TrajectoryDocument,
  TrajectoryDocumentOptions,
  TrajectoryRecord,
  TrajectoryRecordKind,
  TrajectoryRecordStatus,
  TrajectoryTask,
  TrajectoryTool,
  TrajectoryTurn,
  TrajectoryUsage,
} from "./types.ts";
import type { AgentTurn } from "../../agent-core/index.ts";

export const TRAJECTORY_FORMAT = "projector.trajectory";
export const TRAJECTORY_VERSION = 1;

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
const STATUSES = new Set<TrajectoryRecordStatus>(["running", "done", "error", "stopped"]);

type JsonObject = Record<string, unknown>;

const objectOf = (value: unknown): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
const stringOf = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
const nonEmpty = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value : fallback;
const numberOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const booleanOf = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;
const arrayOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function usageOf(value: unknown): TrajectoryUsage | undefined {
  const raw = objectOf(value);
  if (!raw) return undefined;
  const usage: TrajectoryUsage = {};
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "cost"] as const) {
    const number = numberOf(raw[key]);
    if (number !== undefined) usage[key] = number;
  }
  return Object.keys(usage).length ? usage : undefined;
}

function contextOf(value: unknown): TrajectoryContext | undefined {
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
  const status =
    raw.status === "running" || raw.status === "error" || raw.status === "done"
      ? raw.status
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

function recordOf(value: unknown, index: number): TrajectoryRecord {
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
  const meta = metaOf(raw.meta);
  if (meta) record.meta = meta;
  return record;
}

function looksLikeChatTurns(value: unknown[]): value is AgentTurn[] {
  return (
    value.length > 0 &&
    value.every((turn) => {
      const raw = objectOf(turn);
      return !!raw && (raw.role === "user" || raw.role === "assistant");
    })
  );
}

function sumUsage(records: readonly TrajectoryRecord[]): TrajectoryUsage | undefined {
  let usage: TrajectoryUsage | undefined;
  for (const record of records) {
    if (!record.usage) continue;
    usage ??= {};
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "cost"] as const) {
      const value = record.usage[key];
      if (value !== undefined) usage[key] = (usage[key] ?? 0) + value;
    }
  }
  return usage;
}

function inferCapabilities(
  turns: readonly TrajectoryTurn[],
  records: readonly TrajectoryRecord[],
  provided: unknown,
): TrajectoryCapabilities {
  const raw = objectOf(provided) ?? {};
  const any = (predicate: (record: TrajectoryRecord) => boolean) => records.some(predicate);
  const usage = turns.some((turn) => turn.usage !== undefined) || any((record) => !!record.usage);
  return {
    steps: raw.steps === true,
    ttft: raw.ttft === true,
    tools:
      raw.tools === true || any((record) => record.kind === "tool" || record.kind === "subtool"),
    tasks: raw.tasks === true || any((record) => record.kind === "task"),
    usage: raw.usage === true || usage,
    costs:
      raw.costs === true ||
      turns.some((turn) => turn.usage?.cost !== undefined) ||
      any((record) => record.usage?.cost !== undefined),
    context: raw.context === true || turns.some((turn) => turn.context !== undefined),
    compaction: raw.compaction === true || any((record) => record.kind === "compaction"),
    live: raw.live === true || any((record) => record.status === "running"),
  };
}

function countsOf(turns: readonly TrajectoryTurn[], records: readonly TrajectoryRecord[]) {
  return {
    turns: turns.length,
    records: records.length,
    tools: records.filter((record) => record.kind === "tool" || record.kind === "subtool").length,
    tasks: records.filter((record) => record.kind === "task").length,
    errors: records.filter((record) => record.status === "error").length,
    running: records.filter((record) => record.status === "running").length,
  };
}

function turnTitle(records: readonly TrajectoryRecord[], number: number): string {
  const user = records.find((record) => record.kind === "user");
  return user?.text || user?.title || `Ход ${number}`;
}

function turnOf(value: unknown, index: number): TrajectoryTurn {
  const raw = objectOf(value) ?? {};
  const number = Math.max(0, Math.floor(numberOf(raw.number) ?? numberOf(raw.turn) ?? index + 1));
  const status = STATUSES.has(raw.status as TrajectoryRecordStatus)
    ? (raw.status as TrajectoryRecordStatus)
    : "done";
  const startedAt = numberOf(raw.startedAt);
  const endedAt = numberOf(raw.endedAt);
  const usage = usageOf(raw.usage);
  const context = contextOf(raw.context);
  return {
    number,
    id: nonEmpty(raw.id, `turn:${number}`),
    title: nonEmpty(raw.title, `Ход ${number}`),
    status,
    records: [],
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(usage === undefined ? {} : { usage }),
    ...(context === undefined ? {} : { context }),
  };
}

function parseInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`Некорректный JSON: ${error instanceof Error ? error.message : "ошибка"}`);
  }
}

/** Normalize a command payload or a `.trajectory.json` document into a panel model. */
export function trajectoryDocumentFrom(
  value: unknown,
  options: TrajectoryDocumentOptions = {},
): TrajectoryDocument {
  const parsed = parseInput(value);
  const root = Array.isArray(parsed) ? { records: parsed } : objectOf(parsed);
  if (!root) throw new Error("Данные траектории должны быть объектом или JSON-строкой");
  if (root.format !== undefined && root.format !== TRAJECTORY_FORMAT)
    throw new Error(`Неизвестный формат: ожидается ${TRAJECTORY_FORMAT}`);
  if (root.version !== undefined && root.version !== TRAJECTORY_VERSION)
    throw new Error(`Неподдерживаемая версия траектории: ${JSON.stringify(root.version)}`);
  const dataValue = root.data !== undefined ? parseInput(root.data) : undefined;
  const payload = root.data === undefined ? root : objectOf(dataValue);
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("data должен быть объектом");
  const rawTurns = arrayOf(payload.turns);
  const rawRecords = arrayOf(payload.records);
  if (looksLikeChatTurns(rawTurns)) {
    const data = trajectoryFromTurns(rawTurns, { busy: false });
    return {
      id: options.id ?? nonEmpty(root.id, nextDocumentId()),
      title: options.title ?? nonEmpty(root.title, data.turns[0]?.title ?? "Траектория"),
      ...((options.subtitle ?? nonEmpty(root.subtitle, ""))
        ? { subtitle: options.subtitle ?? nonEmpty(root.subtitle, "") }
        : {}),
      data,
      ...((options.source ?? nonEmpty(root.source, ""))
        ? { source: options.source ?? nonEmpty(root.source, "") }
        : {}),
      updatedAt: Date.now(),
    };
  }

  const records = (
    rawRecords.length
      ? rawRecords
      : rawTurns.flatMap((turn, turnIndex) => {
          const raw = objectOf(turn) ?? {};
          const number = numberOf(raw.number) ?? numberOf(raw.turn) ?? Math.max(0, turnIndex + 1);
          return arrayOf(raw.records).map((record) => {
            const item = objectOf(record) ?? {};
            return item.turn === undefined ? { ...item, turn: number } : item;
          });
        })
  ).map(recordOf);
  if (!records.length) throw new Error("В документе нет записей траектории");

  const turns = rawTurns.map(turnOf);
  const byNumber = new Map(turns.map((turn) => [turn.number, turn]));
  for (const record of records) {
    let turn = byNumber.get(record.turn);
    if (!turn) {
      turn = {
        number: record.turn,
        id: `turn:${record.turn}`,
        title: `Ход ${record.turn}`,
        status: "done",
        records: [],
      };
      byNumber.set(record.turn, turn);
      turns.push(turn);
    }
    turn.records.push(record);
  }
  turns.sort((left, right) => left.number - right.number);
  for (const turn of turns) {
    if (/^Ход \d+$/.test(turn.title)) turn.title = turnTitle(turn.records, turn.number);
    turn.startedAt ??= turn.records.find((record) => record.startedAt !== undefined)?.startedAt;
    turn.endedAt ??= turn.records.reduce<number | undefined>(
      (last, record) =>
        record.endedAt !== undefined && (last === undefined || record.endedAt > last)
          ? record.endedAt
          : last,
      undefined,
    );
    if (turn.status === "done") {
      if (turn.records.some((record) => record.status === "error")) turn.status = "error";
      else if (turn.records.some((record) => record.status === "running")) turn.status = "running";
    }
    turn.usage ??= sumUsage(turn.records);
  }

  const counts = countsOf(turns, records);
  const usage = turns.reduce<TrajectoryUsage>((total, turn) => {
    if (!turn.usage) return total;
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "cost"] as const) {
      const value = turn.usage[key];
      if (value !== undefined) total[key] = (total[key] ?? 0) + value;
    }
    return total;
  }, {});
  const title = options.title ?? nonEmpty(root.title, turns[0]?.title ?? "Траектория");
  const subtitle = options.subtitle ?? nonEmpty(root.subtitle, "");
  const notice = stringOf(payload.notice) || undefined;

  return {
    id: options.id ?? nonEmpty(root.id, nextDocumentId()),
    title,
    ...(subtitle ? { subtitle } : {}),
    ...((options.source ?? nonEmpty(root.source, ""))
      ? { source: options.source ?? nonEmpty(root.source, "") }
      : {}),
    data: {
      turns,
      records,
      counts,
      usage,
      capabilities: inferCapabilities(turns, records, payload.capabilities),
      ...(notice ? { notice } : {}),
    },
    updatedAt: Date.now(),
  };
}
