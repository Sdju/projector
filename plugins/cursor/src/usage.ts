import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentUsage, AgentUsageWindowDefinition } from "./api.ts";

const USAGE_URL = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const NETWORK_CONTEXT_URL = "https://ipwho.is/";
const AUTH_UNAVAILABLE = "Авторизация Cursor недоступна; выполните agent login";
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

function configHome(): string {
  if (process.env.XDG_CONFIG_HOME) return process.env.XDG_CONFIG_HOME;
  if (process.platform === "win32")
    return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return join(homedir(), ".config");
}

const authCandidates = () => [
  join(configHome(), "cursor", "auth.json"),
  join(configHome(), "Cursor", "auth.json"),
];

/** The auth file lives under either spelling of the directory; the first readable one wins. */
async function readFirstReadable(): Promise<string> {
  for (const path of authCandidates()) {
    try {
      return await readFile(path, "utf8");
    } catch {
      /* Try the next location. */
    }
  }
  throw new Error(AUTH_UNAVAILABLE);
}

/** Use Cursor Agent CLI credentials; never write or publish the auth file. */
export async function readCursorAccessToken(): Promise<string> {
  let auth: unknown;
  try {
    auth = JSON.parse(process.env.CURSOR_AUTH_CONTENT ?? (await readFirstReadable()));
  } catch {
    throw new Error(AUTH_UNAVAILABLE);
  }
  const token =
    auth && typeof auth === "object" ? (auth as Record<string, unknown>).accessToken : null;
  if (typeof token !== "string" || !token.trim()) throw new Error(AUTH_UNAVAILABLE);
  return token;
}

/** Fixed public probe; usage requests do not run until the EU network context is confirmed. */
async function assertEuNetworkContext(timeoutMs: number): Promise<void> {
  let response: Response;
  try {
    response = await fetch(NETWORK_CONTEXT_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch {
    throw new Error("Не удалось проверить сетевой контекст");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Не удалось проверить сетевой контекст");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Не удалось проверить сетевой контекст");
  }
  const probe =
    body && typeof body === "object" ? (body as { success?: unknown; is_eu?: unknown }) : null;
  if (probe?.success !== true || probe.is_eu !== true)
    throw new Error("Не удалось проверить сетевой контекст");
}

/** Fixed official destination, bounded request, no upstream body in errors. */
export async function readCursorUsage(timeoutMs = 10000): Promise<unknown> {
  const token = await readCursorAccessToken();
  await assertEuNetworkContext(timeoutMs);
  let response: Response;
  try {
    response = await fetch(USAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      body: "{}",
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch {
    throw new Error("Не удалось получить лимиты Cursor");
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401)
      throw new Error("Авторизация Cursor истекла; выполните agent login");
    if (response.status === 403) throw new Error("Подписка Cursor недоступна");
    throw new Error(`Cursor: ошибка HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Некорректный ответ Cursor");
  }
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
