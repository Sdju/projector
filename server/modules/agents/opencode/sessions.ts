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
