import { createUsageCache } from "../_/usage-cache.ts";
import type { CodexUsage, CodexUsageWindow } from "../../../../core/modules/agents-integration/codex/index.ts";
import { readCodexRateLimits } from "./cli.ts";

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;

export function weeklyWindow(payload: unknown): CodexUsageWindow | null {
  const data = record(payload);
  const buckets = record(data?.rateLimitsByLimitId);
  const limits = record(buckets?.codex) ?? record(data?.rateLimits);
  for (const name of ["primary", "secondary"]) {
    const window = record(limits?.[name]);
    if (window?.windowDurationMins !== 7 * 24 * 60) continue;
    const used = window.usedPercent;
    if (typeof used !== "number" || !Number.isFinite(used) || used < 0 || used > 100) continue;
    const reset = window.resetsAt;
    return {
      usedPercent: used,
      windowDurationMins: window.windowDurationMins,
      resetsAt: typeof reset === "number" && Number.isFinite(reset) && reset > 0 ? reset : null,
    };
  }
  return null;
}

const globalState = globalThis as typeof globalThis & {
  projectorCodexUsage?: { value?: CodexUsage; pending?: Promise<CodexUsage> };
};
const state = (globalState.projectorCodexUsage ??= {});

/** Share polls across workspaces and HMR; expose only normalized usage, never account data. */
export const codexUsage = createUsageCache(state, async (): Promise<CodexUsage> => {
  try {
    const weekly = weeklyWindow(await readCodexRateLimits());
    return {
      status: weekly ? "ready" : "unavailable",
      weekly,
      checkedAt: Date.now(),
      message: weekly ? null : "Недельный лимит Codex недоступен",
    };
  } catch (error) {
    return {
      status: "unavailable",
      weekly: null,
      checkedAt: Date.now(),
      message: error instanceof Error ? error.message : "Codex CLI недоступен",
    };
  }
});
