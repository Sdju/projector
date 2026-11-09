import {
  expectedUsagePercent,
  limitPeriodSeconds,
  type LimitPoint,
  type LimitSeries,
} from "@projector/core/modules/usage-analytics/index.ts";
import {
  insertLimitSample,
  readLatestLimitSamples,
  readLimitSamples,
  type LimitSample,
} from "./store.ts";

type Payload = Record<string, unknown>;

const recordOf = (value: unknown): Payload | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Payload) : null;

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** One window of any adapter shape: `usedPercent`, optional reset and rate-limit flag. */
function windowOf(
  value: unknown,
): { used: number; resetsAt: number | null; limited: boolean } | null {
  const item = recordOf(value);
  const raw = finite(item?.usedPercent);
  if (!item || raw === null || raw < 0) return null;
  const resetsAt = finite(item.resetsAt);
  return {
    used: Math.min(100, raw),
    resetsAt: resetsAt !== null && resetsAt > 0 ? resetsAt : null,
    limited: item.limited === true || raw >= 100,
  };
}

/** Windows of a usage answer: most adapters use `windows`, Codex keeps its only one as `weekly`. */
export function usageWindowsOf(usage: unknown): Map<string, ReturnType<typeof windowOf>> {
  const payload = recordOf(usage);
  const windows = new Map<string, ReturnType<typeof windowOf>>();
  if (!payload || payload.status !== "ready") return windows;
  const named = recordOf(payload.windows);
  if (named) {
    for (const [name, value] of Object.entries(named)) {
      const window = windowOf(value);
      if (window) windows.set(name, window);
    }
  }
  if (!windows.size) {
    const weekly = windowOf(payload.weekly);
    if (weekly) windows.set("weekly", weekly);
  }
  return windows;
}

/**
 * Remembers what an adapter just said. Called after every successful usage request, so the chart
 * grows while the status bar polls and a cached answer never adds a second point.
 */
export function recordAgentLimits(agent: string, usage: unknown): void {
  try {
    const payload = recordOf(usage);
    if (!payload) return;
    const checkedAt = finite(payload.checkedAt);
    const at = checkedAt !== null && checkedAt > 0 ? checkedAt : Date.now();
    for (const [window, value] of usageWindowsOf(payload)) {
      if (!value) continue;
      insertLimitSample({
        agent,
        window,
        at,
        used: value.used,
        resetsAt: value.resetsAt,
        limited: value.limited,
      });
    }
  } catch {
    // A chart is not worth failing the usage request it was recorded from.
  }
}

/** The last uninterrupted stretch of growth, so a reset inside the range does not skew the pace. */
function growth(samples: readonly LimitSample[]): { points: LimitPoint[]; rate: number | null } {
  let start = 0;
  for (let index = 1; index < samples.length; index++) {
    if (samples[index]!.used < samples[index - 1]!.used - 5) start = index;
  }
  const stretch = samples.slice(start);
  const points = stretch.map((sample) => ({ at: sample.at, used: sample.used }));
  const first = stretch[0];
  const last = stretch.at(-1);
  if (!first || !last) return { points, rate: null };
  const hours = (last.at - first.at) / 3600000;
  if (hours < 10 / 60) return { points, rate: null };
  const rate = (last.used - first.used) / hours;
  return { points, rate: Number.isFinite(rate) && rate > 0 ? rate : null };
}

const MAX_POINTS = 240;

function thin(points: readonly LimitPoint[]): LimitPoint[] {
  if (points.length <= MAX_POINTS) return [...points];
  const step = Math.ceil(points.length / MAX_POINTS);
  const kept = points.filter((_, index) => index % step === 0);
  if (kept.at(-1) !== points.at(-1)) kept.push(points.at(-1)!);
  return kept;
}

/**
 * Limit windows as the analytics page shows them: samples of the range plus the newest look,
 * two estimates of where the window is going, and the known cycle length for the pace.
 */
export function readLimitSeries(since: number, now = Date.now()): LimitSeries[] {
  const latest = readLatestLimitSamples();
  const samples = readLimitSamples(since);
  const grouped = new Map<string, LimitSample[]>();
  for (const sample of samples) {
    const key = `${sample.agent}\n${sample.window}`;
    const list = grouped.get(key);
    if (list) list.push(sample);
    else grouped.set(key, [sample]);
  }
  const latestByKey = new Map(
    latest.map((sample) => [`${sample.agent}\n${sample.window}`, sample]),
  );
  for (const key of latestByKey.keys()) if (!grouped.has(key)) grouped.set(key, []);

  const series: LimitSeries[] = [];
  for (const [key, list] of grouped) {
    const newest = latestByKey.get(key);
    if (!newest) continue;
    if (!list.length || list.at(-1)!.at !== newest.at) list.push(newest);
    const { points, rate } = growth(list);
    const periodSeconds = limitPeriodSeconds(newest.window);
    const resetsAt = newest.resetsAt;
    const remainingHours = resetsAt !== null ? Math.max(0, resetsAt - now / 1000) / 3600 : null;
    const projected =
      rate !== null && remainingHours !== null
        ? Math.min(200, Math.max(0, newest.used + rate * remainingHours))
        : null;
    series.push({
      agent: newest.agent,
      window: newest.window,
      points: thin(points),
      usedPercent: newest.used,
      resetsAt,
      limited: newest.limited,
      periodSeconds,
      expectedPercent: expectedUsagePercent(periodSeconds, resetsAt, now),
      projectedPercent: projected,
      ratePerHour: rate,
    });
  }
  return series.sort((a, b) => a.agent.localeCompare(b.agent) || a.window.localeCompare(b.window));
}
