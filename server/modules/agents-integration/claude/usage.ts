import { createUsageCache } from "../_/usage-cache.ts";
import type { ClaudeUsage, ClaudeUsageWindow } from "../../../../core/modules/agents-integration/claude/index.ts";
import { ClaudeUsageError, readClaudeUsage } from "./client.ts";

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

export function claudeWindows(payload: unknown): ClaudeUsage["windows"] {
  const usage = record(payload);
  function window(name: string): ClaudeUsageWindow | null {
    const value = record(usage?.[name]);
    const percent = value?.utilization;
    if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0) return null;
    const reset = typeof value?.resets_at === "string" ? Date.parse(value.resets_at) : NaN;
    return {
      usedPercent: Math.min(100, percent), limited: percent >= 100,
      resetsAt: Number.isFinite(reset) && reset > 0 ? Math.floor(reset / 1000) : null,
    };
  }
  const rolling = window("five_hour"), weekly = window("seven_day");
  return rolling || weekly ? { rolling, weekly } : null;
}

const globalState = globalThis as typeof globalThis & {
  projectorClaudeUsage?: { value?: ClaudeUsage; pending?: Promise<ClaudeUsage>; throttles: number };
};
const state = (globalState.projectorClaudeUsage ??= { throttles: 0 });
const interval = 5 * 60000;

/** Cache for all tabs and HMR; throttle failures defer even concurrent callers. */
export const claudeUsage = createUsageCache(state, async (): Promise<ClaudeUsage> => {
  try {
    const windows = claudeWindows(await readClaudeUsage());
    state.throttles = 0;
    const checkedAt = Date.now();
    return {
      status: windows ? "ready" : "unavailable", windows, checkedAt,
      nextCheckAt: checkedAt + interval,
      message: windows ? null : "Лимиты подписки Claude Code недоступны",
    };
  } catch (error) {
    let delay = interval;
    if (error instanceof ClaudeUsageError && error.retryAfterMs !== null) {
      state.throttles = Math.min(state.throttles + 1, 4);
      delay = Math.max(Math.min(interval * 2 ** (state.throttles - 1), 30 * 60000), error.retryAfterMs);
    } else state.throttles = 0;
    const checkedAt = Date.now();
    return {
      status: "unavailable", windows: null, checkedAt, nextCheckAt: checkedAt + delay,
      message: error instanceof Error ? error.message : "Claude Code недоступен",
    };
  }
}, (value) => value.nextCheckAt);
