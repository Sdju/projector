import type { UsageAnalytics } from "@projector-ai/core/modules/usage-analytics/index.ts";

/** The whole analytics answer: chat usage of the range and the newest limit windows. */
export async function readUsageAnalytics(days: number): Promise<UsageAnalytics> {
  const response = await fetch(`/api/analytics?days=${encodeURIComponent(String(days))}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Аналитика недоступна: HTTP ${response.status}`);
  return (await response.json()) as UsageAnalytics;
}
