import { createUsageCache } from "../_/usage-cache.ts";
import type {
  KimiUsage,
  KimiUsageWindow,
} from "@projector-ai/core/modules/agents-integration/kimi/index.ts";
import { readKimiUsage } from "./client.ts";

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function numberValue(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function resetsAt(value: unknown): number | null {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed / 1000);
  }
  const numeric = numberValue(value);
  if (numeric !== null && numeric > 0) return Math.floor(numeric > 1e12 ? numeric / 1000 : numeric);
  return null;
}

function countWindow(value: unknown): KimiUsageWindow | null {
  const entry = record(value);
  const limit = numberValue(entry?.limit);
  let used = numberValue(entry?.used);
  const remaining = numberValue(entry?.remaining);
  if (used === null && remaining !== null && limit !== null) used = limit - remaining;
  if (limit === null || limit <= 0 || used === null) return null;
  return {
    usedPercent: Math.min(100, Math.max(0, (used / limit) * 100)),
    resetsAt: resetsAt(entry?.resetTime ?? entry?.reset_time ?? entry?.resetAt ?? entry?.reset_at),
    limited: used >= limit,
  };
}

/** A `used_ratio` window of the `usages` object (limit_5h, limit_7d, limit_month_total). */
function ratioWindow(value: unknown): KimiUsageWindow | null {
  const entry = record(value);
  const ratio = numberValue(entry?.used_ratio);
  if (ratio === null || ratio < 0) return null;
  return {
    usedPercent: Math.min(100, ratio * 100),
    resetsAt: resetsAt(entry?.reset_time ?? entry?.resetTime ?? entry?.reset_at),
    limited: ratio >= 1,
  };
}

/** The monthly membership quota: absolute used/limit in `totalQuota` (older payload shape). */
function totalWindow(value: unknown): KimiUsageWindow | null {
  const total = record(value);
  const used = numberValue(total?.used);
  const limit = numberValue(total?.limit);
  if (used === null || limit === null || limit <= 0) return null;
  const usedPercent = Math.min(100, Math.max(0, (used / limit) * 100));
  return {
    usedPercent,
    resetsAt: resetsAt(total?.resetTime ?? total?.reset_at ?? total?.reset_time),
    limited: used >= limit,
  };
}

function durationMinutes(value: unknown): number | null {
  const window = record(value);
  const duration = numberValue(window?.duration);
  const unit = typeof window?.timeUnit === "string" ? window.timeUnit.toUpperCase() : "";
  if (duration === null || duration <= 0) return null;
  if (unit.includes("MINUTE")) return duration;
  if (unit.includes("HOUR")) return duration * 60;
  if (unit.includes("DAY")) return duration * 24 * 60;
  if (unit.includes("WEEK")) return duration * 7 * 24 * 60;
  return null;
}

/** Older responses count requests: top-level `usage` is the week, `limits[]` are shorter windows. */
function legacyWindows(body: Record<string, unknown> | null): KimiUsage["windows"] {
  const result: NonNullable<KimiUsage["windows"]> = {};
  const weekly = countWindow(body?.usage);
  if (weekly) result.weekly = weekly;
  const limits = Array.isArray(body?.limits) ? body.limits : [];
  for (const item of limits) {
    const entry = record(item);
    const detail = record(entry?.detail) ?? entry;
    const count = countWindow(detail);
    if (!count) continue;
    const minutes = durationMinutes(entry?.window);
    const name =
      minutes === 300
        ? "rolling"
        : minutes === 7 * 24 * 60
          ? "weekly"
          : minutes === 30 * 24 * 60
            ? "monthly"
            : null;
    if (name && !result[name]) result[name] = count;
  }
  return Object.keys(result).length ? result : null;
}

export function kimiWindows(payload: unknown): KimiUsage["windows"] {
  const body = record(payload);
  const usages = record(body?.usages);
  const legacy = legacyWindows(body);
  const rolling = ratioWindow(usages?.limit_5h) ?? legacy?.rolling;
  const weekly = ratioWindow(usages?.limit_7d) ?? legacy?.weekly;
  const monthly =
    ratioWindow(usages?.limit_month_total) ??
    ratioWindow(usages?.limit_month_code) ??
    totalWindow(body?.totalQuota) ??
    legacy?.monthly;
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
export const kimiUsage = createUsageCache(
  state,
  async (): Promise<KimiUsage> => {
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
  },
  /* A failed refresh can recover as soon as the CLI writes a new pair; retry sooner than a success. */
  (value) => value.checkedAt + (value.status === "ready" ? 60000 : 10000),
);
