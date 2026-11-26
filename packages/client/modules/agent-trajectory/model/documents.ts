/** The trajectory document format, its normalizer, and the in-memory documents a tab or panel reads. */

import { nextDocumentId } from "./document-id.ts";
import { trajectoryFromTurns } from "./trajectory.ts";
import type {
  TrajectoryDocument,
  TrajectoryDocumentOptions,
  TrajectoryRecord,
  TrajectoryTurn,
  TrajectoryUsage,
  TrajectoryCapabilities,
  TrajectoryRecordStatus,
} from "./types.ts";
import {
  STATUSES,
  objectOf,
  stringOf,
  nonEmpty,
  numberOf,
  contextOf,
  usageOf,
  recordOf,
} from "./document-records.ts";
import type { AgentTurn } from "../../agent-core/index.ts";

export const TRAJECTORY_FORMAT = "projector.trajectory";
export const TRAJECTORY_VERSION = 1;

const arrayOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

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
