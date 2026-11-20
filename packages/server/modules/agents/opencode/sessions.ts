import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AcpFollowUp, AcpFollowUpOptions, AcpFollowUpResult } from "../acp/index.ts";
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

/**
 * The latest message of a session and the last step that ended. OpenCode writes an `idle` row
 * when a step is over and no row at all when it is still running, so the pair tells a step that
 * started after a background report from one that never came.
 */
export interface OpenCodeStepState {
  /** Kind of the latest transcript message; `idle` means the session finished its step. */
  last: string;
  /** Sequence of the latest message, unique within the session. */
  seq: number;
  /** Sequence of the latest `idle` message, `0` when no step ever ended. */
  idle: number;
  /** The latest assistant step ended with an error, even if an idle row followed it. */
  interrupted: boolean;
  /** Human prompt boundaries, including messages hidden behind later assistant rows. */
  user: number;
  firstUser: number;
}

export function openCodeStepState(sessionId: string, after = 0): OpenCodeStepState | undefined {
  if (!sessionId) return undefined;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(openCodeDatabasePath(), { readOnly: true, timeout: 500 });
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_message'")
      .get() as { name?: string } | undefined;
    if (!table) return undefined;
    db.exec("BEGIN");
    const last = db
      .prepare(
        "SELECT type, seq, data FROM session_message WHERE session_id = ? ORDER BY seq DESC LIMIT 1",
      )
      .get(sessionId) as { type?: unknown; seq?: unknown; data?: unknown } | undefined;
    const users = db
      .prepare(
        "SELECT MIN(seq) AS first, MAX(seq) AS last FROM session_message WHERE session_id = ? AND type = 'user' AND seq > ?",
      )
      .get(sessionId, after) as { first: number | null; last: number | null };
    if (!last) return { last: "idle", seq: 0, idle: 0, interrupted: false, user: 0, firstUser: 0 };
    if (typeof last.seq !== "number") return undefined;
    const idle = db
      .prepare("SELECT MAX(seq) AS seq FROM session_message WHERE session_id = ? AND type = 'idle'")
      .get(sessionId) as { seq?: unknown } | undefined;
    // The final idle row can hide an assistant error between polls. Read the latest assistant
    // in this run, not just the last transcript row (a later successful retry replaces it).
    const assistant = db
      .prepare(
        "SELECT data FROM session_message WHERE session_id = ? AND type = 'assistant' AND seq > ? ORDER BY seq DESC LIMIT 1",
      )
      .get(sessionId, after) as { data?: unknown } | undefined;
    let interrupted = false;
    if (typeof assistant?.data === "string") {
      const data = JSON.parse(assistant.data) as { finish?: unknown; error?: unknown };
      interrupted = data.finish === "error" || (data.error !== undefined && data.error !== null);
    }
    return {
      last: typeof last.type === "string" ? last.type : "",
      seq: last.seq,
      idle: typeof idle?.seq === "number" ? idle.seq : 0,
      interrupted,
      user: users.last ?? 0,
      firstUser: users.first ?? 0,
    };
  } catch {
    /* Missing database or another schema: there is nothing to follow. */
    return undefined;
  } finally {
    db?.close();
  }
}

/** Minimum report window, ACP quiet window, and observation deadline for pending children. */
const FOLLOW_UP_START_MS = 5_000;
const FOLLOW_UP_QUIET_MS = 3_000;
const FOLLOW_UP_TOTAL_MS = 20 * 60_000;

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export interface OpenCodeFollowUpOptions extends Partial<AcpFollowUpOptions> {
  read?: (sessionId: string) => OpenCodeStepState | undefined;
  lastUpdateAt?: () => number;
  intervalMs?: number;
  startMs?: number;
  quietMs?: number;
  totalMs?: number;
}

function superseded(state: OpenCodeStepState): boolean {
  return state.firstUser > 0 && state.user > state.firstUser;
}

/** Capture transcript position before session/prompt, not after the last child has finished. */
export function prepareOpenCodeFollowUp(
  sessionId: string,
  readState: typeof openCodeStepState = openCodeStepState,
): AcpFollowUp {
  const baseline = readState(sessionId);
  let lostUpdate = false;
  let replaced = false;
  let lastUpdateAt = 0;
  // Reuse ownership only for adjacent chunks of the same message in the same source session.
  // Structural events invalidate every source, so no elapsed-time window can admit a new turn.
  const messages = new Map<string, string>();
  const read = () => {
    const state = baseline && !lostUpdate ? readState(sessionId, baseline.seq) : undefined;
    if (state && superseded(state)) replaced = true;
    return state;
  };
  return {
    acceptsUpdates: (sourceSession, update) => {
      if (lostUpdate || replaced) return false;
      const chunk =
        update.sessionUpdate === "agent_message_chunk" ||
        update.sessionUpdate === "agent_thought_chunk";
      const messageId = typeof update.messageId === "string" ? update.messageId : "";
      const meta = update._meta as Record<string, unknown> | undefined;
      const child = meta?.["opencode/child-session"] as { id?: unknown } | undefined;
      const childId = typeof child?.id === "string" ? child.id : "";
      const source = JSON.stringify([sourceSession, childId]);
      const reusable = chunk && !!messageId && !!sourceSession;
      if (!reusable || messages.get(source) !== messageId) {
        // Missing identity is a conservative fallback, never a cache entry.
        if (!reusable) messages.clear();
        const state = read();
        // Once a chunk could not be attributed, later reads cannot repair the lost content.
        if (!state) lostUpdate = true;
        if (!state || replaced) return false;
        if (reusable) messages.set(source, messageId);
      }
      lastUpdateAt = Date.now();
      return true;
    },
    wait: (options) =>
      baseline
        ? watchOpenCodeFollowUp(sessionId, { ...options, read, lastUpdateAt: () => lastUpdateAt })
        : Promise.resolve({
            status: "unavailable",
            error: "Не удалось прочитать состояние продолжения OpenCode",
          }),
  };
}

/** Observe tracked children until their final report; autonomous parent work may outlive the answer. */
export async function watchOpenCodeFollowUp(
  sessionId: string,
  options: OpenCodeFollowUpOptions = {},
): Promise<AcpFollowUpResult> {
  const read = options.read ?? openCodeStepState;
  const interval = options.intervalMs ?? 1_000;
  const startMs = options.startMs ?? FOLLOW_UP_START_MS;
  const quietMs = options.quietMs ?? FOLLOW_UP_QUIET_MS;
  const totalMs = options.totalMs ?? FOLLOW_UP_TOTAL_MS;
  const started = Date.now();
  let quietAt: number | undefined;
  let childrenClearedAt: number | undefined;
  let notified = false;
  let missed = 0;
  for (;;) {
    if (options.signal?.aborted) return { status: "aborted" };
    const state = read(sessionId);
    if (!state) {
      quietAt = undefined;
      if (++missed >= 3)
        return { status: "unavailable", error: "Потеряно наблюдение за продолжением OpenCode" };
    } else {
      missed = 0;
      if (superseded(state)) return { status: "superseded" };
      if (state.interrupted)
        return { status: "failed", error: "Продолжение OpenCode прервано с ошибкой" };
      const pending = options.pending?.() ?? 0;
      const incoming = options.incomingActivity?.();
      const now = Date.now();
      const running = state.last !== "idle" && state.seq > state.idle;
      if (running && !notified) {
        options.onStart?.();
        notified = true;
      }
      if (!running) notified = false;
      if (pending) {
        childrenClearedAt = undefined;
        quietAt = undefined;
        if (!incoming?.pending && now - started >= totalMs)
          return {
            status: "timeout",
            error: "Истекло время наблюдения за продолжением OpenCode; агент может ещё работать",
          };
      } else {
        childrenClearedAt ??= now;
        if (incoming?.pending) quietAt = undefined;
        else
          quietAt = Math.max(
            quietAt ?? now,
            options.lastUpdateAt?.() ?? 0,
            incoming?.lastReplyAt ?? 0,
          );
        // After end_turn the parent may keep working in SQLite alone. Allow time for the child
        // report and for accepted ACP updates or replies to settle before detaching.
        if (quietAt !== undefined && now - quietAt >= quietMs && now - childrenClearedAt >= startMs)
          return { status: "completed" };
      }
    }
    await pause(interval, options.signal);
  }
}

/** Marks sessions started by a subagent, so history can show them as branches of their chat. */ export async function withOpenCodeBranches(
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
