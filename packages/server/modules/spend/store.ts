import { mkdirSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "@projector-ai/core/modules/app-paths/index.ts";

/** One minute of one task's model calls; calls inside the minute are summed. */
export interface TaskSample {
  /** Minute bucket, ms since the epoch. */
  minute: number;
  task: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  priced: boolean;
}

/** A saved minute bucket with its call counts. */
export interface StoredTaskSample extends TaskSample {
  calls: number;
  pricedCalls: number;
}

/**
 * Service calls are tiny and frequent (Lens runs while the agent works). A minute bucket keeps the
 * chart honest without one row per caption; a year is the hard limit.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS task_samples (
    minute INTEGER NOT NULL,
    task TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    input INTEGER NOT NULL DEFAULT 0,
    output INTEGER NOT NULL DEFAULT 0,
    cache_read INTEGER NOT NULL DEFAULT 0,
    cache_write INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    calls INTEGER NOT NULL DEFAULT 0,
    priced_calls INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (minute, task, provider, model)
  );
  CREATE INDEX IF NOT EXISTS task_samples_time ON task_samples (minute);
`;

const databases = new Map<string, DatabaseSync>();
let lastCompact = 0;

export function spendDatabase(): DatabaseSync {
  const directory = join(dataDir(), "agent");
  const file = join(directory, "spend.sqlite");
  const open = databases.get(file);
  if (open) return open;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  void chmod(file, 0o600).catch(() => {});
  databases.set(file, db);
  return db;
}

/** Closes the opened database (a test removing its data directory, a restart). */
export function closeSpendStore(): void {
  for (const db of databases.values()) db.close();
  databases.clear();
  lastCompact = 0;
}

function compact(db: DatabaseSync, now: number): void {
  if (now - lastCompact < 3600000) return;
  lastCompact = now;
  db.prepare("DELETE FROM task_samples WHERE minute < ?").run(now - 365 * 86400000);
}

/** Adds one call to its minute, task and model; calls in the same minute are summed. */
export function addTaskSample(sample: TaskSample): void {
  const db = spendDatabase();
  const minute = Math.floor(sample.minute / 60000) * 60000;
  db.prepare(
    `INSERT INTO task_samples
       (minute, task, provider, model, input, output, cache_read, cache_write, cost, calls, priced_calls)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT (minute, task, provider, model) DO UPDATE SET
       input = input + excluded.input,
       output = output + excluded.output,
       cache_read = cache_read + excluded.cache_read,
       cache_write = cache_write + excluded.cache_write,
       cost = cost + excluded.cost,
       calls = calls + 1,
       priced_calls = priced_calls + excluded.priced_calls`,
  ).run(
    minute,
    sample.task,
    sample.provider,
    sample.model,
    sample.input,
    sample.output,
    sample.cacheRead,
    sample.cacheWrite,
    sample.cost,
    sample.priced ? 1 : 0,
  );
  compact(db, Date.now());
}

interface TaskRow {
  minute: number;
  task: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cost: number;
  calls: number;
  priced_calls: number;
}

/** Task buckets since `since`, oldest first. */
export function readTaskSamples(since: number): StoredTaskSample[] {
  const rows = spendDatabase()
    .prepare("SELECT * FROM task_samples WHERE minute >= ? ORDER BY minute")
    .all(since) as unknown as TaskRow[];
  return rows.map((row) => ({
    minute: row.minute,
    task: row.task,
    provider: row.provider,
    model: row.model,
    input: row.input,
    output: row.output,
    cacheRead: row.cache_read,
    cacheWrite: row.cache_write,
    cost: row.cost,
    priced: row.priced_calls > 0,
    calls: row.calls,
    pricedCalls: row.priced_calls,
  }));
}
