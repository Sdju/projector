import type {
  ProviderPoint,
  ProviderSpend,
} from "@projector/core/modules/usage-analytics/index.ts";
import { insertProviderSample, readProviderSamples, type ProviderSample } from "./store.ts";

type Payload = Record<string, unknown>;

const recordOf = (value: unknown): Payload | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Payload) : null;

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Amounts arrive as decimal strings; `null` means the provider sent something unusable. */
const amountOf = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
};

const MAX_POINTS = 240;

function thin(points: readonly ProviderPoint[]): ProviderPoint[] {
  if (points.length <= MAX_POINTS) return [...points];
  const step = Math.ceil(points.length / MAX_POINTS);
  const kept = points.filter((_, index) => index % step === 0);
  if (kept.at(-1) !== points.at(-1)) kept.push(points.at(-1)!);
  return kept;
}

/**
 * Remembers what a provider said about its money. Called after a balance request, so the chart
 * grows while the status bar or the provider page polls and a cached answer adds no point.
 */
export function recordProviderBalance(balance: unknown): void {
  try {
    const payload = recordOf(balance);
    if (!payload || payload.status !== "ready") return;
    const entries = payload.entries;
    if (!Array.isArray(entries)) return;
    const provider =
      typeof payload.providerId === "string" && payload.providerId
        ? payload.providerId
        : "provider";
    const providerName =
      typeof payload.providerName === "string" && payload.providerName
        ? payload.providerName
        : provider;
    const checkedAt = finite(payload.checkedAt) ?? Date.now();
    for (const item of entries) {
      const entry = recordOf(item);
      if (!entry || typeof entry.currency !== "string" || !entry.currency) continue;
      const total = amountOf(entry.total);
      if (total === null) continue;
      insertProviderSample({
        provider,
        providerName,
        currency: entry.currency,
        at: checkedAt,
        total,
        granted: amountOf(entry.granted) ?? 0,
        toppedUp: amountOf(entry.toppedUp) ?? 0,
      });
    }
  } catch {
    // A chart is not worth failing the balance request it was recorded from.
  }
}

interface Pairs {
  spent: number;
  toppedUp: number;
}

/** Balance drops are money spent; increases are top-ups and grants, not negative spend. */
function movement(points: readonly ProviderSample[]): Pairs {
  let spent = 0;
  let toppedUp = 0;
  for (let index = 1; index < points.length; index++) {
    const before = points[index - 1]!.total;
    const after = points[index]!.total;
    if (after < before) spent += before - after;
    else if (after > before) toppedUp += after - before;
  }
  return { spent, toppedUp };
}

/**
 * Money the provider's API actually had and lost in the range. A sample just before the range
 * serves as the starting balance, so the first day's spend is not lost.
 */
export function readProviderSpend(since: number): ProviderSpend[] {
  const grouped = new Map<string, ProviderSample[]>();
  for (const sample of readProviderSamples(0)) {
    const key = `${sample.provider}\n${sample.currency}`;
    const list = grouped.get(key);
    if (list) list.push(sample);
    else grouped.set(key, [sample]);
  }

  const result: ProviderSpend[] = [];
  for (const list of grouped.values()) {
    const newest = list.at(-1);
    if (!newest) continue;
    // The last look before the range starts the money calculation and anchors the chart.
    const before = list.filter((sample) => sample.at < since).at(-1);
    const inRange = list.filter((sample) => sample.at >= since);
    const counted = before ? [before, ...inRange] : inRange;
    const movementOfRange = movement(counted);
    const points = thin([...(before ? [before] : []), ...inRange]).map((sample) => ({
      at: sample.at,
      total: sample.total,
    }));
    result.push({
      provider: newest.provider,
      label: newest.providerName || newest.provider,
      currency: newest.currency,
      points,
      total: newest.total,
      spent: movementOfRange.spent,
      toppedUp: movementOfRange.toppedUp,
      checkedAt: newest.at,
    });
  }

  return result.sort(
    (a, b) =>
      Number(b.currency === "USD") - Number(a.currency === "USD") ||
      a.label.localeCompare(b.label) ||
      a.currency.localeCompare(b.currency),
  );
}
