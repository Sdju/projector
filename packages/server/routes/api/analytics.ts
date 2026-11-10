import {
  dayUsageAnalytics,
  isDayKey,
  usageAnalytics,
} from "../../modules/usage-analytics/index.ts";
import { json, type RouteDefinition } from "../../modules/transport/index.ts";

const MAX_DAYS = 365;

/** Days of the range, clamped to something the store and the charts can serve. */
function daysOf(value: string | null): number {
  const days = Number(value);
  if (!Number.isFinite(days)) return 30;
  return Math.min(MAX_DAYS, Math.max(1, Math.round(days)));
}

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/analytics",
    handler: async ({ res, url }) => {
      res.setHeader("Cache-Control", "no-store");
      const days = daysOf(url.searchParams.get("days"));
      json(res, 200, await usageAnalytics(days));
    },
  },
  {
    method: "GET",
    path: "/api/analytics/day",
    handler: async ({ res, url }) => {
      res.setHeader("Cache-Control", "no-store");
      const day = url.searchParams.get("day") ?? "";
      if (!isDayKey(day)) {
        json(res, 400, { error: "День должен быть реальной датой в формате YYYY-MM-DD" });
        return;
      }
      json(res, 200, await dayUsageAnalytics(day));
    },
  },
];
