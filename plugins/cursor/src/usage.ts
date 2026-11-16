import type { AgentUsage, AgentUsageWindowDefinition } from "./api.ts";
import { assertEuNetworkContext, cursorPostJson, readCursorAccessToken } from "./session.ts";

export { readCursorAccessToken } from "./session.ts";

const USAGE_URL = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const MONTH_SECONDS = 30 * 24 * 60 * 60;

interface CursorUsageWindow {
  usedPercent: number;
  resetsAt: number | null;
  limited: boolean;
}

type CursorWindows = Record<"total" | "auto" | "api", CursorUsageWindow>;

/** Labels and pace the shared status-bar indicator uses for Cursor's three windows. */
export const cursorUsageWindows: readonly AgentUsageWindowDefinition[] = [
  {
    name: "total",
    label: "Всего",
    shortLabel: "вс",
    periodSeconds: MONTH_SECONDS,
    ticks: [7, 14, 21, 28].map((day) => (day / 30) * 100),
  },
  {
    name: "auto",
    label: "Авто",
    shortLabel: "авт",
    periodSeconds: MONTH_SECONDS,
    ticks: [7, 14, 21, 28].map((day) => (day / 30) * 100),
  },
  {
    name: "api",
    label: "API",
    shortLabel: "API",
    periodSeconds: MONTH_SECONDS,
    ticks: [7, 14, 21, 28].map((day) => (day / 30) * 100),
  },
];

/** Fixed official destination, bounded request, no upstream body in errors. */
export async function readCursorUsage(timeoutMs = 10000): Promise<unknown> {
  const token = await readCursorAccessToken();
  await assertEuNetworkContext(timeoutMs);
  return cursorPostJson(
    USAGE_URL,
    "{}",
    {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
    },
    timeoutMs,
    "Не удалось получить лимиты Cursor",
  );
}

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

export function cursorWindows(payload: unknown): CursorWindows | null {
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

/** The provider Projector's generic `/api/agent/usage/cursor` route calls. */
export async function readCursorLimits(now = Date.now()): Promise<AgentUsage> {
  try {
    const windows = cursorWindows(await readCursorUsage());
    return windows
      ? { status: "ready", windows, checkedAt: now }
      : {
          status: "unavailable",
          windows: null,
          checkedAt: now,
          message: "Лимиты Cursor недоступны",
        };
  } catch (error) {
    return {
      status: "unavailable",
      windows: null,
      checkedAt: now,
      message: error instanceof Error ? error.message : "Cursor недоступен",
    };
  }
}

export const cursorUsageProvider = {
  kind: "function" as const,
  read: readCursorLimits,
  timeoutMs: 25_000,
};
