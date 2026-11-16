import type { AgentBackend, AgentUsage, AgentUsageWindowDefinition, ClaudeSdk } from "./api.ts";
import { readClaudeUsage } from "./usage-client.ts";

interface Window {
  usedPercent: number;
  resetsAt: number | null;
  limited: boolean;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** The plan windows Claude Code reports, in the generic shape the status bar shows. */
export function claudeWindows(payload: unknown): Record<string, Window> | null {
  const usage = record(payload);
  function window(name: string): Window | null {
    const value = record(usage?.[name]);
    const percent = value?.utilization;
    if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0) return null;
    const reset = typeof value?.resets_at === "string" ? Date.parse(value.resets_at) : NaN;
    return {
      usedPercent: Math.min(100, percent),
      limited: percent >= 100,
      resetsAt: Number.isFinite(reset) && reset > 0 ? Math.floor(reset / 1000) : null,
    };
  }
  const rolling = window("five_hour");
  const weekly = window("seven_day");
  return rolling || weekly
    ? { ...(weekly ? { weekly } : {}), ...(rolling ? { rolling } : {}) }
    : null;
}

/** The labels and pace of Claude Code's windows; the status bar cycles them in this order. */
export const claudeUsageWindows: readonly AgentUsageWindowDefinition[] = [
  {
    name: "weekly",
    label: "Неделя",
    shortLabel: "нед",
    periodSeconds: 7 * 86400,
    ticks: [1, 2, 3, 4, 5, 6].map((day) => (day / 7) * 100),
  },
  {
    name: "rolling",
    label: "5 часов",
    shortLabel: "5ч",
    periodSeconds: 5 * 3600,
    ticks: [20, 40, 60, 80],
  },
];

/**
 * The limits provider of the plugin. The Agent SDK asks Claude Code itself; a failure is reported
 * as an explicit unavailable answer and never affects the chat.
 */
export function createClaudeUsageProvider(sdk: ClaudeSdk): NonNullable<AgentBackend["usage"]> {
  return {
    kind: "function",
    timeoutMs: 40_000,
    read: async (checkedAt): Promise<AgentUsage> => {
      try {
        const windows = claudeWindows(await readClaudeUsage(sdk));
        return windows
          ? { status: "ready", windows, checkedAt }
          : {
              status: "unavailable",
              windows: null,
              checkedAt,
              message: "Лимиты подписки Claude Code недоступны",
            };
      } catch (error) {
        return {
          status: "unavailable",
          windows: null,
          checkedAt,
          message: error instanceof Error ? error.message : "Claude Code недоступен",
        };
      }
    },
  };
}
