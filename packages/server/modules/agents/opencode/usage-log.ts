import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  UsageLogEvent,
  UsageLogRead,
  UsageLogReader,
  UsageTokens,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
import { os } from "@ai-projector/core/modules/os/index.ts";
import { walkFiles } from "../../usage-log/index.ts";

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const parsed = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  return record(value);
};

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function tokensOf(value: unknown): UsageTokens | null {
  const tokens = record(value);
  if (!tokens) return null;
  const cache = record(tokens.cache);
  return {
    input: count(tokens.input),
    output: count(tokens.output),
    cacheRead: count(cache?.read),
    cacheWrite: count(cache?.write),
  };
}

function empty(tokens: UsageTokens): boolean {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite === 0;
}

/** One assistant message of either storage version: `opencode.db` or the older JSON file. */
function eventOf(
  message: Record<string, unknown>,
  fallback: { id: string; session: string; at?: number; cwd?: string },
): UsageLogEvent | null {
  if (message.role && message.role !== "assistant") return null;
  const tokens = tokensOf(message.tokens);
  if (!tokens || empty(tokens)) return null;
  const time = record(message.time);
  const at = number(time?.completed) ?? number(time?.created) ?? fallback.at ?? null;
  if (at === null) return null;
  const cost = number(message.cost);
  const id = text(message.id) || fallback.id;
  const session = text(message.sessionID) || fallback.session;
  const path = record(message.path);
  const model = text(message.modelID) || text(record(message.model)?.id) || text(message.model);
  const cwd = text(path?.cwd) || fallback.cwd || "";
  return {
    session,
    event: id,
    at,
    ...(model ? { model } : {}),
    ...(cwd ? { cwd } : {}),
    tokens,
    ...(cost !== null ? { cost } : {}),
    costSource: cost !== null ? "recorded" : "none",
  };
}

/** Older OpenCode versions keep one JSON per message under `storage/message`. */
export async function readOpenCodeUsage(file: string): Promise<UsageLogEvent[]> {
  const message = record(JSON.parse(await readFile(file, "utf8")) as unknown);
  if (!message) return [];
  const event = eventOf(message, {
    id: basename(file, ".json"),
    session: basename(dirname(file)),
  });
  return event ? [event] : [];
}

interface StoredMessage {
  id: string;
  session_id: string;
  time_created: number;
  data: string;
}

interface VersionTwoMessage {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  tokens: string | null;
  cost: number | null;
  model: string | null;
  completed: number | null;
  created: number | null;
  directory: string | null;
}

/**
 * OpenCode keeps messages in `opencode.db`. Version two stores per-request usage in
 * `session_message` and the session directory in `session_v2`; the older `message` table is read
 * only on the first pass. The cursor is the newest `time_updated`, so a growing database is not
 * parsed from the beginning on every analytics request.
 */
export async function readOpenCodeDatabase(file: string, state?: string): Promise<UsageLogRead> {
  const since = state && Number.isFinite(Number(state)) ? Number(state) : 0;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 2000;");
    const tables = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as {
          name: string;
        }[]
      ).map((row) => row.name),
    );
    const events: UsageLogEvent[] = [];
    let newest = since;
    if (!since && tables.has("message")) {
      const legacy = db
        .prepare(
          "SELECT id, session_id, time_created, data FROM message WHERE data LIKE '%\"tokens\"%'",
        )
        .all() as unknown as StoredMessage[];
      for (const row of legacy) {
        let message: Record<string, unknown> | null;
        try {
          message = record(JSON.parse(row.data) as unknown);
        } catch {
          continue;
        }
        if (!message) continue;
        const event = eventOf(message, {
          id: row.id,
          session: row.session_id,
          at: row.time_created,
        });
        if (event) events.push(event);
        newest = Math.max(newest, row.time_created);
      }
    }

    if (!tables.has("session_message") || !tables.has("session_v2")) {
      return { events, ...(newest ? { state: String(newest) } : {}) };
    }
    const rows = db
      .prepare(
        `SELECT m.id, m.session_id, m.time_created, m.time_updated,
           json_extract(m.data, '$.tokens') AS tokens,
           json_extract(m.data, '$.cost') AS cost,
           json_extract(m.data, '$.model') AS model,
           json_extract(m.data, '$.time.completed') AS completed,
           json_extract(m.data, '$.time.created') AS created,
           s.directory AS directory
         FROM session_message AS m
         LEFT JOIN session_v2 AS s ON s.id = m.session_id
         WHERE m.type = 'assistant' AND m.time_updated >= ?
           AND json_extract(m.data, '$.tokens') IS NOT NULL`,
      )
      .all(since) as unknown as VersionTwoMessage[];
    for (const row of rows) {
      const tokens = tokensOf(row.tokens === null ? null : (JSON.parse(row.tokens) as unknown));
      if (!tokens || empty(tokens)) continue;
      const model = parsed(row.model);
      const at = row.completed ?? row.created ?? row.time_created;
      events.push({
        session: row.session_id,
        event: row.id,
        at,
        ...(text(model?.id) ? { model: text(model?.id) } : {}),
        ...(row.directory ? { cwd: row.directory } : {}),
        tokens,
        ...(typeof row.cost === "number" ? { cost: row.cost } : {}),
        costSource: typeof row.cost === "number" ? "recorded" : "none",
      });
      newest = Math.max(newest, row.time_updated);
    }
    return { events, ...(newest ? { state: String(newest) } : {}) };
  } finally {
    db.close();
  }
}

const openCodeRoot = () => join(os.dataHome(), "opencode");
const openCodeDatabase = () => join(openCodeRoot(), "opencode.db");
const openCodeMessages = () => join(openCodeRoot(), "storage", "message");

export const opencodeUsageLog: UsageLogReader = {
  agent: "opencode",
  label: "OpenCode",
  // The database holds prompts and tool output too, so it is much larger than a rollout.
  maxBytes: 4 * 1024 * 1024 * 1024,
  append: (file) => file.endsWith(".db"),
  roots: () => [openCodeRoot()],
  async files() {
    const legacy = await walkFiles(
      openCodeMessages(),
      (name) => name.startsWith("msg_") && name.endsWith(".json"),
      3,
    );
    const db = openCodeDatabase();
    // The database is read last: if an old JSON message was migrated, the database owns it.
    return [...legacy, ...(existsSync(db) ? [db] : [])];
  },
  read: (file, state) =>
    file.endsWith(".db") ? readOpenCodeDatabase(file, state) : readOpenCodeUsage(file),
};
