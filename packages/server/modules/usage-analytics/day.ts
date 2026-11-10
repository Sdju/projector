import type {
  UsageBreakdown,
  UsageDayAnalytics,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
import { readAgentUsage } from "../agent/index.ts";
import { loadProjects } from "../projects/index.ts";
import { taskSpend } from "../spend/index.ts";
import { dayKey, dayStart } from "./log-days.ts";
import { readUsageEvents } from "./log-store.ts";
import { refreshUsageLogs } from "./logs.ts";
import {
  add,
  breakdown,
  chatRecord,
  emptyHours,
  emptyTotals,
  eventRecord,
  hourly,
  projectLocator,
  taskBreakdown,
  type UsageRecord,
} from "./records.ts";

/** Midnight of the day after `YYYY-MM-DD`; a calendar step keeps DST from shortening the day. */
export function nextDayStart(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, month! - 1, date! + 1).getTime();
}

/** True for a real local calendar day in `YYYY-MM-DD`, not for `2026-02-31`. */
export function isDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return dayKey(dayStart(value)) === value;
}

function emptyDay(day: string): UsageDayAnalytics {
  const at = dayStart(day);
  return {
    day,
    at,
    until: nextDayStart(day),
    totals: emptyTotals(),
    hourly: emptyHours(day),
    byAgent: [],
    byModel: [],
    byProject: [],
    byTask: [],
    serviceCalls: 0,
  };
}

/**
 * One local day from the same records the range charts use. The heatmap opens it by click; the
 * native journals contribute through their events, so a terminal run keeps its hour too.
 */
export async function dayUsageAnalytics(day: string, now = Date.now()): Promise<UsageDayAnalytics> {
  const at = dayStart(day);
  if (at > now) return emptyDay(day);
  const until = nextDayStart(day);
  await refreshUsageLogs(at, now);
  const projects = await loadProjects();
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const locate = projectLocator(projects);
  const records: UsageRecord[] = [
    ...readAgentUsage(at)
      .filter((record) => record.at < until)
      .map(chatRecord),
    ...readUsageEvents(at, until).map((row) => eventRecord(row, locate)),
  ];
  const service = taskSpend(at, until);
  const totals = emptyTotals();
  for (const record of records) add(totals, record);
  const byProject: UsageBreakdown[] = breakdown(
    records,
    (record) =>
      projectNames.get(record.project) ?? (record.project ? "другой проект" : "Без проекта"),
  );
  return {
    day,
    at,
    until,
    totals,
    hourly: hourly(records, day),
    byAgent: breakdown(records, (record) => record.backend || "неизвестный"),
    byModel: breakdown(records, (record) => record.model ?? "модель не указана"),
    byProject,
    byTask: taskBreakdown(records, service.byTask),
    serviceCalls: service.calls,
  };
}
