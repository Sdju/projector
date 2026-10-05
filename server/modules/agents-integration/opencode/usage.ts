import { createUsageCache } from "../_/usage-cache.ts";
import type { OpenCodeUsage, OpenCodeUsageWindow } from "../../../../core/modules/agents-integration/opencode/index.ts";
import { readGoUsage } from "./client.ts";

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

export function goWindows(payload: unknown): OpenCodeUsage["windows"] {
  const usage = record(record(payload)?.usage);
  function window(name: string): OpenCodeUsageWindow | null {
    const value = record(usage?.[name]);
    const percent = value?.percent;
    if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100)
      return null;
    if (value?.status !== "ok" && value?.status !== "rate-limited") return null;
    const reset = typeof value.resetsAt === "string" ? Date.parse(value.resetsAt) : NaN;
    const limited = value.status === "rate-limited";
    return {
      usedPercent: limited ? 100 : percent,
      resetsAt: Number.isFinite(reset) && reset > 0 ? Math.floor(reset / 1000) : null,
      limited,
    };
  }
  const rolling = window("rolling"), weekly = window("weekly"), monthly = window("monthly");
  return rolling && weekly && monthly ? { rolling, weekly, monthly } : null;
}

const globalState = globalThis as typeof globalThis & {
  projectorOpenCodeUsage?: { value?: OpenCodeUsage; pending?: Promise<OpenCodeUsage> };
};
const state = (globalState.projectorOpenCodeUsage ??= {});

/** One poll for all windows, including during HMR; credentials stay on the server. */
export const openCodeUsage = createUsageCache(state, async (): Promise<OpenCodeUsage> => {
  try {
    const windows = goWindows(await readGoUsage());
    return {
      status: windows ? "ready" : "unavailable", windows, checkedAt: Date.now(),
      message: windows ? null : "Лимиты OpenCode Go недоступны",
    };
  } catch (error) {
    return {
      status: "unavailable", windows: null, checkedAt: Date.now(),
      message: error instanceof Error ? error.message : "OpenCode Go недоступен",
    };
  }
});
