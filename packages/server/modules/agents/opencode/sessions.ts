import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentSessionInfo } from "../../agent/index.ts";

/** Parent and agent of a session, as OpenCode itself keeps them. */
export interface OpenCodeSessionMeta {
  parent?: string;
  agent?: string;
}

/**
 * OpenCode keeps its data under XDG paths on every OS (`packages/util/global-roots.ts`), so the
 * Projector data directory is not used here.
 */
export function openCodeDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "opencode.db");
}

/** Table that holds sessions: `session_v2` in OpenCode 2, `session` in the older schema. */
function sessionTable(db: DatabaseSync): string | undefined {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('session_v2', 'session') ORDER BY name = 'session_v2' DESC LIMIT 1",
    )
    .get() as { name?: string } | undefined;
  return row?.name;
}

/**
 * Reads which sessions are branches of a subagent from OpenCode's own database. ACP lists those
 * branches as ordinary sessions and does not say who their parent is, so the list cannot be kept
 * apart without this lookup. Any failure (another version, a locked file) just leaves the list
 * as the agent reported it.
 */
export async function openCodeSessionMeta(
  ids: string[],
): Promise<Map<string, OpenCodeSessionMeta>> {
  const meta = new Map<string, OpenCodeSessionMeta>();
  if (!ids.length) return meta;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(openCodeDatabasePath(), { readOnly: true, timeout: 500 });
    const table = sessionTable(db);
    if (!table) return meta;
    const placeholders = ids.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT id, parent_id, agent FROM ${table} WHERE id IN (${placeholders})`)
      .all(...ids) as { id: string; parent_id?: unknown; agent?: unknown }[];
    for (const row of rows) {
      const parent = typeof row.parent_id === "string" && row.parent_id ? row.parent_id : undefined;
      const agent = typeof row.agent === "string" && row.agent ? row.agent : undefined;
      if (parent || agent)
        meta.set(row.id, { ...(parent ? { parent } : {}), ...(agent ? { agent } : {}) });
    }
  } catch {
    /* OpenCode is missing, holds the database, or changed it: the plain list is still usable. */
  } finally {
    db?.close();
  }
  return meta;
}

/**
 * How a child session ended, when OpenCode has parked it. ACP does not push the background
 * `<subagent state=…>` notify onto the live prompt wire — only into the next model turn — so the
 * hard-hold path reads this to clear tasks that already finished.
 *
 * Only `idle_outcome` says the turn is over. `time_suspended` is a queue claim of the execution
 * lifecycle: OpenCode 2 sets it for a background child while the child is still working, so it
 * settles nothing there — it dates from the schema that had no outcome at all.
 */
export type OpenCodeIdleStatus = "done" | "error" | "stopped";

export function openCodeIdleOutcomes(ids: string[]): Map<string, OpenCodeIdleStatus> {
  const out = new Map<string, OpenCodeIdleStatus>();
  if (!ids.length) return out;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(openCodeDatabasePath(), { readOnly: true, timeout: 500 });
    const table = sessionTable(db);
    if (!table) return out;
    const columnsInfo = db.prepare(`PRAGMA table_info(${table})`).all() as { name?: string }[];
    const hasIdle = columnsInfo.some((column) => column.name === "idle_outcome");
    const hasSuspended = columnsInfo.some((column) => column.name === "time_suspended");
    if (!hasIdle && !hasSuspended) return out;
    const placeholders = ids.map(() => "?").join(", ");
    const columns = [
      "id",
      ...(hasIdle ? ["idle_outcome"] : []),
      ...(hasSuspended ? ["time_suspended"] : []),
    ].join(", ");
    const rows = db
      .prepare(`SELECT ${columns} FROM ${table} WHERE id IN (${placeholders})`)
      .all(...ids) as { id: string; idle_outcome?: unknown; time_suspended?: unknown }[];
    for (const row of rows) {
      const idle = typeof row.idle_outcome === "string" ? row.idle_outcome : "";
      if (idle === "succeeded") out.set(row.id, "done");
      else if (idle === "failed") out.set(row.id, "error");
      else if (idle === "interrupted" || idle === "cancelled") out.set(row.id, "stopped");
      else if (!hasIdle && typeof row.time_suspended === "number" && row.time_suspended > 0)
        out.set(row.id, "stopped");
    }
  } catch {
    /* Missing DB or schema: keep holding until a later notify. */
  } finally {
    db?.close();
  }
  return out;
}

/** Marks sessions started by a subagent, so history can show them as branches of their chat. */
export async function withOpenCodeBranches(
  sessions: AgentSessionInfo[],
): Promise<AgentSessionInfo[]> {
  const meta = await openCodeSessionMeta(sessions.map((session) => session.id));
  if (!meta.size) return sessions;
  return sessions.map((session) => {
    const found = meta.get(session.id);
    if (!found) return session;
    const parent = session.parent ?? found.parent;
    return {
      ...session,
      ...(!session.parent && found.parent ? { parent: found.parent } : {}),
      ...(!session.agent && parent && found.agent ? { agent: found.agent } : {}),
    };
  });
}
