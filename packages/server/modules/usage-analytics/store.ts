import { mkdirSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "@projector/core/modules/app-paths/index.ts";

/** One recorded look at a limit window. `at` is when the service answered, not when we asked. */
export interface LimitSample {
  agent: string;
  window: string;
  at: number;
  used: number;
  resetsAt: number | null;
  limited: boolean;
}

/** One recorded look at a provider's money balance. */
export interface ProviderSample {
  provider: string;
  providerName: string;
  currency: string;
  at: number;
  total: number;
  granted: number;
  toppedUp: number;
}

/**
 * Samples are tiny and plentiful: a minute of polling per window for months. Recent samples stay
 * as they are; older ones keep the last look of each hour, and a year is the hard limit.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS limit_samples (
    agent TEXT NOT NULL,
    window TEXT NOT NULL,
    at INTEGER NOT NULL,
    used REAL NOT NULL,
    resets_at INTEGER,
    limited INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (agent, window, at)
  );
  CREATE INDEX IF NOT EXISTS limit_samples_time ON limit_samples (at);
  CREATE TABLE IF NOT EXISTS provider_samples (
    provider TEXT NOT NULL,
    provider_name TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL,
    at INTEGER NOT NULL,
    total REAL NOT NULL,
    granted REAL NOT NULL DEFAULT 0,
    topped_up REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (provider, currency, at)
  );
  CREATE INDEX IF NOT EXISTS provider_samples_time ON provider_samples (at);
`;

const databases = new Map<string, DatabaseSync>();
let lastCompact = 0;

export function analyticsDatabase(): DatabaseSync {
  const directory = join(dataDir(), "agent");
  const file = join(directory, "analytics.sqlite");
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
export function closeAnalyticsStore(): void {
  for (const db of databases.values()) db.close();
  databases.clear();
  lastCompact = 0;
}

function compact(db: DatabaseSync, now: number): void {
  if (now - lastCompact < 3600000) return;
  lastCompact = now;
  db.prepare("DELETE FROM limit_samples WHERE at < ?").run(now - 365 * 86400000);
  db.prepare("DELETE FROM provider_samples WHERE at < ?").run(now - 365 * 86400000);
  const cutoff = now - 48 * 3600000;
  db.prepare(
    `DELETE FROM limit_samples WHERE at < ? AND rowid NOT IN (
       SELECT MAX(rowid) FROM limit_samples
       WHERE at < ? GROUP BY agent, window, CAST(at / 3600000 AS INTEGER)
     )`,
  ).run(cutoff, cutoff);
  db.prepare(
    `DELETE FROM provider_samples WHERE at < ? AND rowid NOT IN (
       SELECT MAX(rowid) FROM provider_samples
       WHERE at < ? GROUP BY provider, currency, CAST(at / 3600000 AS INTEGER)
     )`,
  ).run(cutoff, cutoff);
}

/** Replaces a sample of the same look; polling a cached answer must not add points. */
export function insertLimitSample(sample: LimitSample): void {
  const db = analyticsDatabase();
  const known = db
    .prepare("SELECT 1 FROM limit_samples WHERE agent = ? AND window = ? AND at = ?")
    .get(sample.agent, sample.window, sample.at);
  if (known) return;
  db.prepare(
    `INSERT OR REPLACE INTO limit_samples (agent, window, at, used, resets_at, limited)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    sample.agent,
    sample.window,
    sample.at,
    sample.used,
    sample.resetsAt ?? null,
    sample.limited ? 1 : 0,
  );
  compact(db, Date.now());
}

interface SampleRow {
  agent: string;
  window: string;
  at: number;
  used: number;
  resets_at: number | null;
  limited: number;
}

const sampleOf = (row: SampleRow): LimitSample => ({
  agent: row.agent,
  window: row.window,
  at: row.at,
  used: row.used,
  resetsAt: row.resets_at,
  limited: row.limited === 1,
});

/** Samples of every window since `since`, oldest first. */
export function readLimitSamples(since: number): LimitSample[] {
  const rows = analyticsDatabase()
    .prepare("SELECT * FROM limit_samples WHERE at >= ? ORDER BY at")
    .all(since) as unknown as SampleRow[];
  return rows.map(sampleOf);
}

/** The newest sample of every window, even when it lies outside the requested range. */
export function readLatestLimitSamples(): LimitSample[] {
  const rows = analyticsDatabase()
    .prepare(
      `SELECT samples.* FROM limit_samples AS samples
       JOIN (
         SELECT agent, window, MAX(at) AS at FROM limit_samples GROUP BY agent, window
       ) AS newest
       ON samples.agent = newest.agent AND samples.window = newest.window
       AND samples.at = newest.at`,
    )
    .all() as unknown as SampleRow[];
  return rows.map(sampleOf);
}

/** Replaces a provider look of the same time; a cached balance adds no point. */
export function insertProviderSample(sample: ProviderSample): void {
  const db = analyticsDatabase();
  const known = db
    .prepare("SELECT 1 FROM provider_samples WHERE provider = ? AND currency = ? AND at = ?")
    .get(sample.provider, sample.currency, sample.at);
  if (known) return;
  db.prepare(
    `INSERT OR REPLACE INTO provider_samples
       (provider, provider_name, currency, at, total, granted, topped_up)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sample.provider,
    sample.providerName,
    sample.currency,
    sample.at,
    sample.total,
    sample.granted,
    sample.toppedUp,
  );
  compact(db, Date.now());
}

interface ProviderRow {
  provider: string;
  provider_name: string;
  currency: string;
  at: number;
  total: number;
  granted: number;
  topped_up: number;
}

const providerOf = (row: ProviderRow): ProviderSample => ({
  provider: row.provider,
  providerName: row.provider_name,
  currency: row.currency,
  at: row.at,
  total: row.total,
  granted: row.granted,
  toppedUp: row.topped_up,
});

/** Provider balance samples since `since`, oldest first. */
export function readProviderSamples(since: number): ProviderSample[] {
  const rows = analyticsDatabase()
    .prepare("SELECT * FROM provider_samples WHERE at >= ? ORDER BY at")
    .all(since) as unknown as ProviderRow[];
  return rows.map(providerOf);
}

/** The newest sample of every provider currency, even when it lies outside the range. */
export function readLatestProviderSamples(): ProviderSample[] {
  const rows = analyticsDatabase()
    .prepare(
      `SELECT samples.* FROM provider_samples AS samples
       JOIN (
         SELECT provider, currency, MAX(at) AS at FROM provider_samples
         GROUP BY provider, currency
       ) AS newest
       ON samples.provider = newest.provider AND samples.currency = newest.currency
       AND samples.at = newest.at`,
    )
    .all() as unknown as ProviderRow[];
  return rows.map(providerOf);
}
