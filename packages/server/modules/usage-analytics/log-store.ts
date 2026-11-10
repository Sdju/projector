import type {
  UsageCostSource,
  UsageLogEvent,
  UsageSource,
  UsageSourceStatus,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
import { analyticsDatabase } from "./store.ts";
import { dayKey } from "./log-days.ts";

/** What the last successful scan knows about one journal file. */
export interface UsageFileRow {
  path: string;
  agent: string;
  mtime: number;
  size: number;
  events: number;
  readAt: number;
  error: string | null;
  state: string | null;
}

/** One stored native journal event, as the overview aggregates it. */
export interface UsageEventRow {
  agent: string;
  session: string;
  event: string;
  at: number;
  model: string;
  cwd: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number | null;
  costSource: UsageCostSource;
  file: string;
}

/** A changed day is rebuilt at the end of the scan, not once per journal file. */
function markDirty(db: ReturnType<typeof analyticsDatabase>, at: number): void {
  db.prepare("INSERT OR IGNORE INTO usage_dirty_days (day) VALUES (?)").run(dayKey(at));
}

/** The cursor of one file, or null when it has never been read. */
export function usageFile(path: string): UsageFileRow | null {
  const row = analyticsDatabase().prepare("SELECT * FROM usage_files WHERE path = ?").get(path) as
    | UsageFileRow
    | undefined;
  return row ?? null;
}

/** Paths the agent's last scans remember; a disappeared file is dropped separately. */
export function usageFilePaths(agent: string): string[] {
  const rows = analyticsDatabase()
    .prepare("SELECT path FROM usage_files WHERE agent = ?")
    .all(agent) as unknown as { path: string }[];
  return rows.map((row) => row.path);
}

/**
 * Replaces everything one file contributed. A journal is append-only in practice, but an agent
 * may rewrite its message file, so keeping old rows would count the same request twice.
 */
export function writeUsageFile(
  file: string,
  agent: string,
  stamp: { mtime: number; size: number },
  events: readonly UsageLogEvent[],
  now = Date.now(),
  changes: { append?: boolean; state?: string } = {},
): void {
  const db = analyticsDatabase();
  db.exec("BEGIN");
  try {
    // Days touched by the old rows and the new ones both need their aggregate rebuilt.
    const old = db
      .prepare("SELECT DISTINCT at FROM usage_events WHERE file = ?")
      .all(file) as unknown as { at: number }[];
    for (const row of old) markDirty(db, row.at);
    // An incremental database read returns only new rows; deleting the file would drop the rest.
    if (!changes.append) db.prepare("DELETE FROM usage_events WHERE file = ?").run(file);
    const insert = db.prepare(
      `INSERT OR REPLACE INTO usage_events
         (agent, session, event, at, model, cwd, input, output, cache_read, cache_write,
          cost, cost_source, file)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const event of events) {
      markDirty(db, event.at);
      insert.run(
        agent,
        event.session,
        event.event,
        Math.round(event.at),
        event.model ?? "",
        event.cwd ?? "",
        Math.max(0, Math.round(event.tokens.input)),
        Math.max(0, Math.round(event.tokens.output)),
        Math.max(0, Math.round(event.tokens.cacheRead)),
        Math.max(0, Math.round(event.tokens.cacheWrite)),
        event.cost ?? null,
        event.costSource,
        file,
      );
    }
    const counted = db
      .prepare("SELECT COUNT(*) AS total FROM usage_events WHERE file = ?")
      .get(file) as unknown as { total: number };
    db.prepare(
      `INSERT INTO usage_files (path, agent, mtime, size, events, read_at, error, state)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(path) DO UPDATE SET
         agent = excluded.agent, mtime = excluded.mtime, size = excluded.size,
         events = excluded.events, read_at = excluded.read_at, error = NULL,
         state = COALESCE(excluded.state, usage_files.state)`,
    ).run(file, agent, stamp.mtime, stamp.size, counted.total, now, changes.state ?? null);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Remembers a failed scan, so the next call retries a changed file and the card says why. */
export function markUsageFileError(
  file: string,
  agent: string,
  stamp: { mtime: number; size: number },
  message: string,
  now = Date.now(),
): void {
  const db = analyticsDatabase();
  db.prepare(
    `INSERT INTO usage_files (path, agent, mtime, size, events, read_at, error)
     VALUES (?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       agent = excluded.agent, mtime = excluded.mtime, size = excluded.size,
       read_at = excluded.read_at, error = excluded.error`,
  ).run(file, agent, stamp.mtime, stamp.size, now, message);
}

/** Drops a journal that no longer exists. */
export function forgetUsageFile(path: string): void {
  const db = analyticsDatabase();
  db.exec("BEGIN");
  try {
    const old = db
      .prepare("SELECT DISTINCT at FROM usage_events WHERE file = ?")
      .all(path) as unknown as { at: number }[];
    for (const row of old) markDirty(db, row.at);
    db.prepare("DELETE FROM usage_events WHERE file = ?").run(path);
    db.prepare("DELETE FROM usage_files WHERE path = ?").run(path);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Native journal events in the range, oldest first. */
export function readUsageEvents(since: number, until = Number.POSITIVE_INFINITY): UsageEventRow[] {
  const rows = analyticsDatabase()
    .prepare("SELECT * FROM usage_events WHERE at >= ? AND at < ? ORDER BY at")
    .all(since, until) as unknown as {
    agent: string;
    session: string;
    event: string;
    at: number;
    model: string;
    cwd: string;
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
    cost: number | null;
    cost_source: UsageCostSource;
    file: string;
  }[];
  return rows.map((row) => ({
    agent: row.agent,
    session: row.session,
    event: row.event,
    at: row.at,
    model: row.model,
    cwd: row.cwd,
    input: row.input,
    output: row.output,
    cacheRead: row.cache_read,
    cacheWrite: row.cache_write,
    cost: row.cost,
    costSource: row.cost_source,
    file: row.file,
  }));
}

interface FileStatRow {
  agent: string;
  files: number;
  read_at: number | null;
  errors: number;
  error_message: string | null;
}

interface EventStatRow {
  agent: string;
  events: number;
  recorded: number;
  unpriced: number;
}

/** What the scan itself knows, before it is combined with whether a root exists. */
export function usageLogStats(): Map<
  string,
  {
    files: number;
    readAt: number | null;
    errors: number;
    errorMessage: string | null;
    events: number;
    recorded: number;
    unpriced: number;
  }
> {
  const db = analyticsDatabase();
  const files = db
    .prepare(
      `SELECT agent, COUNT(*) AS files, MAX(read_at) AS read_at,
         SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors,
         MAX(error) AS error_message
       FROM usage_files GROUP BY agent`,
    )
    .all() as unknown as FileStatRow[];
  const events = db
    .prepare(
      `SELECT agent, COUNT(*) AS events,
         SUM(CASE WHEN cost IS NOT NULL THEN 1 ELSE 0 END) AS recorded,
         SUM(CASE WHEN cost IS NULL THEN 1 ELSE 0 END) AS unpriced
       FROM usage_events GROUP BY agent`,
    )
    .all() as unknown as EventStatRow[];
  const stats = new Map<
    string,
    {
      files: number;
      readAt: number | null;
      errors: number;
      errorMessage: string | null;
      events: number;
      recorded: number;
      unpriced: number;
    }
  >();
  for (const row of files)
    stats.set(row.agent, {
      files: row.files,
      readAt: row.read_at,
      errors: row.errors,
      errorMessage: row.error_message,
      events: 0,
      recorded: 0,
      unpriced: 0,
    });
  for (const row of events) {
    const entry = stats.get(row.agent) ?? {
      files: 0,
      readAt: null,
      errors: 0,
      errorMessage: null,
      events: 0,
      recorded: 0,
      unpriced: 0,
    };
    entry.events = row.events;
    entry.recorded = row.recorded;
    entry.unpriced = row.unpriced;
    stats.set(row.agent, entry);
  }
  return stats;
}

/** Stores the state of every reader; the card reads it even before a file was ever parsed. */
export function writeUsageSources(sources: readonly UsageSource[]): void {
  const db = analyticsDatabase();
  db.exec("BEGIN");
  try {
    const insert = db.prepare(
      `INSERT INTO usage_sources
         (agent, label, status, files, events, recorded_events, unpriced_events, last_read_at, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent) DO UPDATE SET
         label = excluded.label, status = excluded.status, files = excluded.files,
         events = excluded.events, recorded_events = excluded.recorded_events,
         unpriced_events = excluded.unpriced_events, last_read_at = excluded.last_read_at,
         message = excluded.message`,
    );
    for (const source of sources)
      insert.run(
        source.agent,
        source.label,
        source.status,
        source.files,
        source.events,
        source.recordedEvents,
        source.unpricedEvents,
        source.lastReadAt,
        source.message ?? null,
      );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

interface SourceRow {
  agent: string;
  label: string;
  status: UsageSourceStatus;
  files: number;
  events: number;
  recorded_events: number;
  unpriced_events: number;
  last_read_at: number | null;
  message: string | null;
}

/** The stored source states, sorted by agent id. */
export function readUsageSources(): UsageSource[] {
  const rows = analyticsDatabase()
    .prepare("SELECT * FROM usage_sources ORDER BY agent")
    .all() as unknown as SourceRow[];
  return rows.map((row) => ({
    agent: row.agent,
    label: row.label,
    status: row.status,
    files: row.files,
    events: row.events,
    recordedEvents: row.recorded_events,
    unpricedEvents: row.unpriced_events,
    lastReadAt: row.last_read_at,
    ...(row.message ? { message: row.message } : {}),
  }));
}

/** Test hook: forgets every journal cursor and event without touching limits or balances. */
export function clearUsageLogStore(): void {
  const db = analyticsDatabase();
  db.exec(
    `DELETE FROM usage_events; DELETE FROM usage_files; DELETE FROM usage_sources;
     DELETE FROM usage_day_totals; DELETE FROM usage_dirty_days; DELETE FROM usage_meta;`,
  );
}
