import type { AgentUsageReport } from "@ai-projector/core/modules/usage-analytics/index.ts";

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * The `projector/usage` extension: an agent reports the tokens of one request, so analytics can
 * count agents whose protocol carries no per-request usage. Unknown or empty reports are ignored.
 */
export function usageReportOf(value: unknown): AgentUsageReport | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const tokens = {
    input: count(record.input),
    output: count(record.output),
    cacheRead: count(record.cacheRead),
    cacheWrite: count(record.cacheWrite),
  };
  if (!tokens.input && !tokens.output && !tokens.cacheRead && !tokens.cacheWrite) return undefined;
  return {
    ...tokens,
    ...(typeof record.model === "string" && record.model ? { model: record.model } : {}),
    ...(typeof record.cost === "number" && Number.isFinite(record.cost) && record.cost >= 0
      ? { cost: record.cost }
      : {}),
  };
}
