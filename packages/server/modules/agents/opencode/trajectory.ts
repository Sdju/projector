/** OpenCode's own SQLite store → the trajectory panel's step-level document. */

import { DatabaseSync } from "node:sqlite";
import { HttpError } from "../../http/index.ts";
import { openTrajectorySession, type TrajectoryProjectScope } from "./trajectory-scope.ts";
import { openCodeDatabasePath } from "./sessions.ts";
import { sessionTitleWithoutInjected, splitFeaturePrompt } from "../../agent-features/index.ts";

import {
  number,
  objectOf,
  preview,
  stepRecords,
  string,
  usageOf,
  type AssistantData,
  type JsonObject,
  type MessageRow,
  type RecordOut,
  type TurnOut,
} from "./trajectory-records.ts";

function ensureTurn(
  turns: Map<number, TurnOut>,
  number: number,
  title?: string,
  startedAt?: number,
): TurnOut {
  let turn = turns.get(number);
  if (!turn) {
    turn = {
      number,
      id: `turn:${number}`,
      title: title || (number ? `Ход ${number}` : "Контекст сессии"),
      status: "done",
      records: [],
      ...(startedAt === undefined ? {} : { startedAt }),
    };
    turns.set(number, turn);
  } else if (title && /^Ход \d+$/.test(turn.title)) turn.title = title;
  if (startedAt !== undefined && turn.startedAt === undefined) turn.startedAt = startedAt;
  return turn;
}

function settleTurn(turn: TurnOut, from: number, time: number, outcome: unknown): void {
  const status =
    outcome === "failed"
      ? "error"
      : outcome === "interrupted" || outcome === "cancelled"
        ? "stopped"
        : "done";
  turn.status = status;
  turn.endedAt = time;
  for (let index = from; index < turn.records.length; index++) {
    const record = turn.records[index]!;
    if (record.status !== "running") continue;
    record.status = status;
    record.endedAt ??= time;
    if (record.startedAt !== undefined)
      record.durationMs ??= Math.max(0, record.endedAt - record.startedAt);
    if (record.tool?.status === "running") {
      record.tool.status = status;
      record.tool.endedAt ??= record.endedAt;
    }
  }
}

function recordMessage(
  row: MessageRow,
  turns: Map<number, TurnOut>,
  sessionId: string,
  state: { turn: number; step: number; settled: number },
): void {
  let data: JsonObject;
  try {
    data = JSON.parse(row.data) as JsonObject;
  } catch {
    return;
  }
  if (row.type === "user") {
    const raw = typeof data.text === "string" ? data.text : "";
    const split = splitFeaturePrompt(raw);
    const text = split.text;
    const time = number(objectOf(data.time)?.created) ?? row.time_created;
    const turnNumber = state.turn + 1;
    state.turn = turnNumber;
    state.step = 0;
    state.settled = 0;
    const turn = ensureTurn(turns, turnNumber, preview(text) || `Ход ${turnNumber}`, time);
    if (split.injected) {
      turn.records.push({
        id: `context:${row.seq}`,
        kind: "context",
        turn: turnNumber,
        title: "Инструкции Projector",
        text: preview(split.injected),
        detail: split.injected,
        status: "done",
        startedAt: time,
      });
    }
    turn.records.push({
      id: `user:${row.seq}`,
      kind: "user",
      turn: turnNumber,
      title: preview(text) || `Ход ${turnNumber}`,
      text: preview(text),
      detail: text,
      status: "done",
      startedAt: time,
    });
    return;
  }
  if (row.type === "assistant") {
    const turnNumber = state.turn;
    const turn = ensureTurn(turns, turnNumber, "Ответ", row.time_created);
    state.step += 1;
    stepRecords(row, data as AssistantData, turn, state.step, sessionId);
    return;
  }
  const turnNumber = state.turn;
  const turn = ensureTurn(turns, turnNumber, "Контекст сессии", row.time_created);
  if (row.type === "compaction") {
    const time = number(objectOf(data.time)?.created) ?? row.time_created;
    const usage = usageOf(data.tokens, data.cost);
    const summary = typeof data.summary === "string" ? data.summary : "";
    const status =
      data.status === "completed" ? "done" : data.status === "error" ? "error" : "running";
    turn.records.push({
      id: `compaction:${row.seq}`,
      kind: "compaction",
      turn: turnNumber,
      title: "Сжатие",
      ...(summary ? { text: preview(summary), detail: summary } : {}),
      status,
      startedAt: time,
      ...(usage === undefined ? {} : { usage }),
      meta: {
        ...(typeof data.reason === "string" ? { reason: data.reason } : {}),
        ...(string(objectOf(data.model)?.id) === undefined
          ? {}
          : { model: string(objectOf(data.model)?.id)! }),
      },
    });
    return;
  }
  if (row.type === "system" || row.type === "synthetic") {
    const text = typeof data.text === "string" ? data.text : "";
    const description = typeof data.description === "string" ? data.description : "";
    const time = number(objectOf(data.time)?.created) ?? row.time_created;
    turn.records.push({
      id: `${row.type}:${row.seq}`,
      kind: row.type === "system" ? "system" : "context",
      turn: turnNumber,
      title: description || preview(text) || (row.type === "system" ? "Система" : "Контекст"),
      ...(text ? { text: preview(text), detail: text } : {}),
      status: "done",
      startedAt: time,
    });
    return;
  }
  if (row.type === "model-switched") {
    const model = objectOf(data.model);
    const time = number(objectOf(data.time)?.created) ?? row.time_created;
    turn.records.push({
      id: `model:${row.seq}`,
      kind: "context",
      turn: turnNumber,
      title: `Модель: ${string(model?.id) ?? "—"}`,
      ...(string(model?.providerID) === undefined
        ? {}
        : { detail: `${string(model?.providerID)} · ${string(model?.id) ?? ""}` }),
      status: "done",
      startedAt: time,
    });
    return;
  }
  if (row.type === "idle") {
    const time = number(objectOf(data.time)?.created) ?? row.time_created;
    settleTurn(turn, state.settled, time, data.outcome);
    state.settled = turn.records.length;
  }
}

export interface OpenCodeTrajectoryRequest {
  sessionId: string;
  project: TrajectoryProjectScope;
  format: "records" | "turns";
}

export type OpenCodeTrajectoryResult =
  | { kind: "turns"; cwd: string }
  | { kind: "records"; json: Uint8Array<ArrayBuffer> }
  | { kind: "error"; status: number; message: string };

/** Run in the worker, including serialization so large sessions stay off the HTTP event loop. */
export function readOpenCodeTrajectory({
  sessionId,
  project,
  format,
}: OpenCodeTrajectoryRequest): Exclude<OpenCodeTrajectoryResult, { kind: "error" }> {
  const db = new DatabaseSync(openCodeDatabasePath(), { readOnly: true, timeout: 500 });
  try {
    db.exec("BEGIN");
    const { cwd, modern, session } = openTrajectorySession(db, sessionId, project);
    if (format === "turns") return { kind: "turns", cwd };
    if (!modern) throw new HttpError(422, "В этой базе OpenCode нет данных о шагах");

    const turns = new Map<number, TurnOut>();
    const state = { turn: 0, step: 0, settled: 0 };
    const rows = db.prepare(
      "SELECT seq, type, time_created, data FROM session_message WHERE session_id = ? ORDER BY seq",
    );
    for (const row of rows.iterate(sessionId)) {
      try {
        recordMessage(row as unknown as MessageRow, turns, sessionId, state);
      } catch {
        // Keep the rest of the session if OpenCode wrote a malformed row.
      }
    }

    const ordered = [...turns.values()].filter((turn) => turn.records.length > 0);
    if (!ordered.length) throw new HttpError(422, "В сессии OpenCode нет записей для траектории");
    const any = (predicate: (record: RecordOut) => boolean) =>
      ordered.some((turn) => turn.records.some(predicate));
    let model: JsonObject | undefined;
    try {
      model = objectOf(
        typeof session.model === "string" ? JSON.parse(session.model) : session.model,
      );
    } catch {
      model = undefined;
    }
    const payload = {
      title: sessionTitleWithoutInjected(string(session.title) || "Сессия OpenCode"),
      subtitle: model
        ? `OpenCode · ${string(model.providerID) ?? ""}/${string(model.id) ?? ""}`
        : "OpenCode",
      data: {
        turns: ordered,
        capabilities: {
          steps: any((record) => record.kind === "assistant" && record.id.startsWith("step:")),
          ttft: any((record) => record.timing?.ttftMs !== undefined),
          tools: any((record) => record.kind === "tool"),
          tasks: false,
          usage: any((record) => record.usage !== undefined),
          costs: any((record) => record.usage?.cost !== undefined),
          context: any((record) => record.kind === "context"),
          compaction: any((record) => record.kind === "compaction"),
          live: any((record) => record.status === "running"),
        },
        notice: "Траектория собрана из записей OpenCode.",
      },
    };
    return { kind: "records", json: new TextEncoder().encode(JSON.stringify(payload)) };
  } finally {
    db.close();
  }
}
