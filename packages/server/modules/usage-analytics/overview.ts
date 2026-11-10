import type {
  UsageAnalytics,
  UsageDay,
  UsageHeatDay,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
import { ANALYTICS_HEATMAP_DAYS } from "@ai-projector/core/modules/usage-analytics/index.ts";
import { readAgentUsage } from "../agent/index.ts";
import { loadProjects } from "../projects/index.ts";
import { readLimitSeries } from "./limits.ts";
import { readProviderSpend } from "./providers.ts";
import { refreshUsageLogs } from "./logs.ts";
import { dayKey, readUsageDayTotals } from "./log-days.ts";
import { readUsageSources } from "./log-store.ts";
import {
  add,
  breakdown,
  chatRecord,
  emptyTotals,
  nativeRecord,
  projectLocator,
  taskBreakdown,
  type UsageRecord,
} from "./records.ts";
import { taskSpend } from "../spend/index.ts";

/** Midnight of the day `days - 1` days ago: the range the charts show, today included. */
export function rangeStart(now: number, days: number): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start.getTime();
}

function daysOf(start: number, count: number): UsageDay[] {
  const days: UsageDay[] = [];
  for (let index = 0; index < count; index++) {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    days.push({ day: dayKey(date.getTime()), at: date.getTime(), ...emptyTotals() });
  }
  return days;
}

function heatDaysOf(start: number, count: number): Map<string, UsageHeatDay> {
  const days = new Map<string, UsageHeatDay>();
  for (let index = 0; index < count; index++) {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    const day = dayKey(date.getTime());
    days.set(day, { day, at: date.getTime(), tokens: 0, answers: 0, cost: 0 });
  }
  return days;
}

/**
 * What the chats spent in the range and how full the subscription windows are. Usage comes from
 * the saved answers and the agents' native journals; journals are scanned incrementally, so a
 * second look at the same range reads only files that changed. The heatmap always covers a year,
 * so the scan is widened even when the charts show a week.
 */
export async function usageAnalytics(days: number, now = Date.now()): Promise<UsageAnalytics> {
  const since = rangeStart(now, days);
  const heatStart = rangeStart(now, ANALYTICS_HEATMAP_DAYS);
  const projects = await loadProjects();
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const locate = projectLocator(projects);
  await refreshUsageLogs(heatStart, now);
  const chatRecords = readAgentUsage(heatStart).map(chatRecord);
  const records: UsageRecord[] = chatRecords.filter((record) => record.at >= since);
  const sinceDay = dayKey(since);
  const nativeCounts = new Map<string, { events: number; recorded: number; unpriced: number }>();
  const nativeRows = readUsageDayTotals(dayKey(heatStart));
  for (const row of nativeRows) {
    if (row.day < sinceDay) continue;
    const counts = nativeCounts.get(row.backend) ?? { events: 0, recorded: 0, unpriced: 0 };
    counts.events += row.answers;
    counts.recorded += row.pricedAnswers;
    counts.unpriced += Math.max(0, row.answers - row.pricedAnswers);
    nativeCounts.set(row.backend, counts);
    records.push(nativeRecord(row, locate));
  }
  const service = taskSpend(since);

  const totals = emptyTotals();
  const daily = new Map(daysOf(since, days).map((day) => [day.day, day]));
  const heatmap = heatDaysOf(heatStart, ANALYTICS_HEATMAP_DAYS);
  for (const record of chatRecords) {
    const heat = heatmap.get(dayKey(record.at));
    if (heat) {
      heat.tokens += record.input + record.output + record.cacheRead + record.cacheWrite;
      heat.answers += 1;
      heat.cost += record.cost ?? 0;
    }
  }
  for (const row of nativeRows) {
    const heat = heatmap.get(row.day);
    if (!heat) continue;
    heat.tokens += row.input + row.output + row.cacheRead + row.cacheWrite;
    heat.answers += row.answers;
    heat.cost += row.cost;
  }
  for (const record of records) {
    add(totals, record);
    const bucket = daily.get(dayKey(record.at));
    if (bucket) add(bucket, record);
  }

  return {
    days,
    since,
    until: now,
    totals,
    daily: [...daily.values()],
    heatmap: [...heatmap.values()],
    byAgent: breakdown(records, (record) => record.backend || "неизвестный"),
    byModel: breakdown(records, (record) => record.model ?? "модель не указана"),
    byProject: breakdown(
      records,
      (record) =>
        projectNames.get(record.project) ?? (record.project ? "другой проект" : "Без проекта"),
    ),
    byTask: taskBreakdown(records, service.byTask),
    service: service.totals,
    serviceCalls: service.calls,
    limits: readLimitSeries(since, now),
    providers: readProviderSpend(since),
    sources: readUsageSources().map((source) => {
      const counts = nativeCounts.get(source.agent);
      return {
        ...source,
        events: counts?.events ?? 0,
        recordedEvents: counts?.recorded ?? 0,
        unpricedEvents: counts?.unpriced ?? 0,
      };
    }),
  };
}
