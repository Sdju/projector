import { analyticsDatabase } from "./store.ts";

/** Local calendar day of a timestamp, `YYYY-MM-DD`. */
export function dayKey(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Midnight of a local calendar day, ms since the epoch. */
export function dayStart(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, month! - 1, date!).getTime();
}

function dayEnd(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, month! - 1, date! + 1).getTime();
}

/** One precomputed day of native usage, grouped by backend, model, place and task. */
export interface UsageDayTotal {
  day: string;
  backend: string;
  model: string;
  /** Project id for chat rows; working directory for native journal rows. */
  place: string;
  task: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  answers: number;
  cost: number;
  pricedAnswers: number;
  recordedCost: number;
  computedCost: number;
}

interface DayTotalRow {
  day: string;
  backend: string;
  model: string;
  place: string;
  task: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  answers: number;
  cost: number;
  priced_answers: number;
  recorded_cost: number;
  computed_cost: number;
}

const dayTotalOf = (row: DayTotalRow): UsageDayTotal => ({
  day: row.day,
  backend: row.backend,
  model: row.model,
  place: row.place,
  task: row.task,
  input: row.input,
  output: row.output,
  cacheRead: row.cache_read,
  cacheWrite: row.cache_write,
  answers: row.answers,
  cost: row.cost,
  pricedAnswers: row.priced_answers,
  recordedCost: row.recorded_cost,
  computedCost: row.computed_cost,
});

/** Precomputed native usage since a local day, for the breakdowns and daily chart. */
export function readUsageDayTotals(sinceDay: string): UsageDayTotal[] {
  const rows = analyticsDatabase()
    .prepare("SELECT * FROM usage_day_totals WHERE day >= ? ORDER BY day")
    .all(sinceDay) as unknown as DayTotalRow[];
  return rows.map(dayTotalOf);
}

/**
 * Rebuilds the day buckets touched since the last scan. The first run after the upgrade marks
 * every existing event's day, so old journal history gets aggregates without a full rescan.
 */
export function rebuildUsageDays(): void {
  const db = analyticsDatabase();
  const version = db
    .prepare("SELECT value FROM usage_meta WHERE key = 'day_totals'")
    .get() as unknown as { value: string } | undefined;
  if (!version) {
    const rows = db.prepare("SELECT DISTINCT at FROM usage_events").all() as unknown as {
      at: number;
    }[];
    for (const day of new Set(rows.map((row) => dayKey(row.at))))
      db.prepare("INSERT OR IGNORE INTO usage_dirty_days (day) VALUES (?)").run(day);
  }
  const dirty = db.prepare("SELECT day FROM usage_dirty_days").all() as unknown as {
    day: string;
  }[];
  if (!dirty.length && version) return;

  const insert = db.prepare(
    `INSERT INTO usage_day_totals
       (day, backend, model, place, task, input, output, cache_read, cache_write,
        answers, cost, priced_answers, recorded_cost, computed_cost)
     SELECT ?, agent, model, cwd,
       CASE WHEN agent = 'projector' THEN 'chat' ELSE 'agent:' || agent END,
       SUM(input), SUM(output), SUM(cache_read), SUM(cache_write), COUNT(*),
       COALESCE(SUM(cost), 0),
       SUM(CASE WHEN cost IS NOT NULL THEN 1 ELSE 0 END),
       COALESCE(SUM(CASE WHEN cost_source = 'recorded' THEN cost ELSE 0 END), 0),
       COALESCE(SUM(CASE WHEN cost_source = 'computed' THEN cost ELSE 0 END), 0)
     FROM usage_events WHERE at >= ? AND at < ?
     GROUP BY agent, model, cwd`,
  );
  db.exec("BEGIN");
  try {
    for (const { day } of dirty) {
      db.prepare("DELETE FROM usage_day_totals WHERE day = ?").run(day);
      insert.run(day, dayStart(day), dayEnd(day));
    }
    db.exec("DELETE FROM usage_dirty_days");
    db.prepare("INSERT OR REPLACE INTO usage_meta (key, value) VALUES ('day_totals', '1')").run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
