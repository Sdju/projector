import { historyDatabase } from "./history-store.ts";

/** One answer that reported token usage, with the chat it belongs to. */
export interface AgentUsageRecord {
  chat: string;
  /** Backend id of the agent that wrote the answer; empty when the chat is no longer indexed. */
  backend: string;
  /** Project id the chat belongs to; empty for the project's own conversation or an unknown chat. */
  project: string;
  /** When the answer was written, ms since the epoch. */
  at: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Cost in the model's tariff currency, when the answer had a price. */
  cost?: number;
  model?: string;
}

interface TurnLike {
  role?: unknown;
  at?: unknown;
  usage?: {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    cost?: unknown;
  };
  context?: { model?: unknown };
}

const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

/** Chat id → where the chat belongs. Archived chats live under `archive:<id>` in the turns table. */
function chatPlaces(): Map<string, { backend: string; project: string }> {
  const db = historyDatabase();
  const places = new Map<string, { backend: string; project: string }>();
  const indexed = db.prepare("SELECT chat, scope, backend FROM chat_index").all() as unknown as {
    chat: string;
    scope: string;
    backend: string;
  }[];
  for (const row of indexed) places.set(row.chat, { backend: row.backend, project: row.scope });
  const archived = db.prepare("SELECT id, project, backend FROM archives").all() as unknown as {
    id: string;
    project: string;
    backend: string;
  }[];
  for (const row of archived)
    places.set(`archive:${row.id}`, { backend: row.backend, project: row.project });
  return places;
}

/**
 * Answers with usage since `since`. Every saved version is counted: a branch that was abandoned
 * still cost tokens. Chats that were deleted keep their answers out of reach of this store.
 */
export function readAgentUsage(since = 0): AgentUsageRecord[] {
  const db = historyDatabase();
  const places = chatPlaces();
  const rows = db
    .prepare("SELECT chat, data FROM turns WHERE data LIKE '%\"usage\"%'")
    .all() as unknown as { chat: string; data: string }[];
  const records: AgentUsageRecord[] = [];
  for (const row of rows) {
    let turn: TurnLike;
    try {
      turn = JSON.parse(row.data) as TurnLike;
    } catch {
      continue;
    }
    const usage = turn.usage;
    if (!usage || turn.role !== "assistant") continue;
    const at = typeof turn.at === "number" && Number.isFinite(turn.at) ? turn.at : 0;
    if (at < since) continue;
    const place = places.get(row.chat);
    const backend = place?.backend ?? (row.chat.includes(":") ? row.chat.split(":")[0]! : "");
    const cost =
      typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0
        ? usage.cost
        : undefined;
    const model =
      typeof turn.context?.model === "string" && turn.context.model
        ? turn.context.model
        : undefined;
    records.push({
      chat: row.chat,
      backend,
      project: place?.project ?? "",
      at,
      input: count(usage.input),
      output: count(usage.output),
      cacheRead: count(usage.cacheRead),
      cacheWrite: count(usage.cacheWrite),
      ...(cost !== undefined ? { cost } : {}),
      ...(model ? { model } : {}),
    });
  }
  return records;
}
