import type {
  UsageAnalytics,
  UsageDayAnalytics,
} from "@ai-projector/core/modules/usage-analytics/index.ts";

/** The whole analytics answer: chat usage of the range and the newest limit windows. */
export async function readUsageAnalytics(days: number): Promise<UsageAnalytics> {
  const response = await fetch(`/api/analytics?days=${encodeURIComponent(String(days))}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Аналитика недоступна: HTTP ${response.status}`);
  return (await response.json()) as UsageAnalytics;
}

/** One local day opened from the heatmap or the day picker. */
export async function readDayUsage(day: string): Promise<UsageDayAnalytics> {
  const response = await fetch(`/api/analytics/day?day=${encodeURIComponent(day)}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Аналитика дня недоступна: HTTP ${response.status}`);
  return (await response.json()) as UsageDayAnalytics;
}
