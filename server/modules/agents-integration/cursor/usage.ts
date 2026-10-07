import { createUsageCache } from "../_/usage-cache.ts";
import type {
  CursorUsage,
  CursorUsageWindow,
} from "../../../../core/modules/agents-integration/cursor/index.ts";
import { readCursorUsage } from "./client.ts";

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function percent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(100, value);
}

function resetsAt(value: unknown): number | null {
  if (typeof value === "string" && value.trim()) {
    const ms = Number(value);
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms / 1000);
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return Math.floor(value > 1e12 ? value / 1000 : value);
  return null;
}

export function cursorWindows(payload: unknown): CursorUsage["windows"] {
  const body = record(payload);
  const plan = record(body?.planUsage);
  if (!plan) return null;
  const reset = resetsAt(body?.billingCycleEnd);
  function window(
    name: "totalPercentUsed" | "autoPercentUsed" | "apiPercentUsed",
  ): CursorUsageWindow | null {
    const used = percent(plan?.[name]);
    if (used === null) return null;
    return { usedPercent: used, resetsAt: reset, limited: used >= 100 };
  }
  const total = window("totalPercentUsed");
  const auto = window("autoPercentUsed");
  const api = window("apiPercentUsed");
  return total && auto && api ? { total, auto, api } : null;
}

const globalState = globalThis as typeof globalThis & {
  projectorCursorUsage?: { value?: CursorUsage; pending?: Promise<CursorUsage> };
};
const state = (globalState.projectorCursorUsage ??= {});

/** One poll for all windows, including during HMR; credentials stay on the server. */
export const cursorUsage = createUsageCache(state, async (): Promise<CursorUsage> => {
  try {
    const windows = cursorWindows(await readCursorUsage());
    return {
      status: windows ? "ready" : "unavailable",
      windows,
      checkedAt: Date.now(),
      message: windows ? null : "Лимиты Cursor недоступны",
    };
  } catch (error) {
    return {
      status: "unavailable",
      windows: null,
      checkedAt: Date.now(),
      message: error instanceof Error ? error.message : "Cursor недоступен",
    };
  }
});
