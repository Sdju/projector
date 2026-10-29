import { createUsageCache } from "../_/usage-cache.ts";
import type {
  KimiUsage,
  KimiUsageWindow,
} from "../../../../core/modules/agents-integration/kimi/index.ts";
import { readKimiUsage } from "./client.ts";

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function resetsAt(value: unknown): number | null {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed / 1000);
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return Math.floor(value > 1e12 ? value / 1000 : value);
  return null;
}

/** A `used_ratio` window of the `usages` object (limit_5h, limit_7d, limit_month_total). */
function ratioWindow(value: unknown): KimiUsageWindow | null {
  const entry = record(value);
  const ratio = entry?.used_ratio;
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0) return null;
  const usedPercent = Math.min(100, ratio * 100);
  return {
    usedPercent,
    resetsAt: resetsAt(entry?.reset_time ?? entry?.resetTime ?? entry?.reset_at),
    limited: ratio >= 1,
  };
}

/** The monthly membership quota: absolute used/limit in `totalQuota` (older payload shape). */
function totalWindow(value: unknown): KimiUsageWindow | null {
  const total = record(value);
  const used = Number(total?.used);
  const limit = Number(total?.limit);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
  const usedPercent = Math.min(100, Math.max(0, (used / limit) * 100));
  return {
    usedPercent,
    resetsAt: resetsAt(total?.resetTime ?? total?.reset_at ?? total?.reset_time),
    limited: used >= limit,
  };
}

export function kimiWindows(payload: unknown): KimiUsage["windows"] {
  const body = record(payload);
  const usages = record(body?.usages);
  const rolling = ratioWindow(usages?.limit_5h);
  const weekly = ratioWindow(usages?.limit_7d);
  const monthly = ratioWindow(usages?.limit_month_total) ?? totalWindow(body?.totalQuota);
  if (!rolling && !weekly && !monthly) return null;
  return {
    ...(rolling ? { rolling } : {}),
    ...(weekly ? { weekly } : {}),
    ...(monthly ? { monthly } : {}),
  };
}

const globalState = globalThis as typeof globalThis & {
  projectorKimiUsage?: { value?: KimiUsage; pending?: Promise<KimiUsage> };
};
const state = (globalState.projectorKimiUsage ??= {});

/** One poll for all windows, including during HMR; credentials stay on the server. */
export const kimiUsage = createUsageCache(state, async (): Promise<KimiUsage> => {
  try {
    const windows = kimiWindows(await readKimiUsage());
    return {
      status: windows ? "ready" : "unavailable",
      windows,
      checkedAt: Date.now(),
      message: windows ? null : "Лимиты Kimi Code недоступны",
    };
  } catch (error) {
    return {
      status: "unavailable",
      windows: null,
      checkedAt: Date.now(),
      message: error instanceof Error ? error.message : "Kimi Code недоступен",
    };
  }
});
