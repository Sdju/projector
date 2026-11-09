import type {
  UsageAnalytics,
  UsageBreakdown,
  UsageDay,
  UsageTotals,
} from "@projector/core/modules/usage-analytics/index.ts";
import { readAgentUsage, type AgentUsageRecord } from "../agent/index.ts";
import { loadProjects } from "../projects/index.ts";
import { readLimitSeries } from "./limits.ts";
import { readProviderSpend } from "./providers.ts";
import { taskSpend } from "../spend/index.ts";

const emptyTotals = (): UsageTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  tokens: 0,
  answers: 0,
  cost: 0,
  pricedAnswers: 0,
});

function add(totals: UsageTotals, record: AgentUsageRecord): void {
  totals.input += record.input;
  totals.output += record.output;
  totals.cacheRead += record.cacheRead;
  totals.cacheWrite += record.cacheWrite;
  totals.tokens += record.input + record.output + record.cacheRead + record.cacheWrite;
  totals.answers += 1;
  if (record.cost !== undefined) {
    totals.cost += record.cost;
    totals.pricedAnswers += 1;
  }
}

/** Local calendar day of a timestamp, `YYYY-MM-DD`. */
function dayKey(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

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

function breakdown(
  records: readonly AgentUsageRecord[],
  keyOf: (record: AgentUsageRecord) => string,
): UsageBreakdown[] {
  const groups = new Map<string, UsageBreakdown>();
  for (const record of records) {
    const key = keyOf(record) || "—";
    const group = groups.get(key) ?? { key, ...emptyTotals() };
    add(group, record);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.tokens - a.tokens);
}

/** Chat answers and Projector's service calls on one scale: where the tokens actually went. */
function taskBreakdown(
  records: readonly AgentUsageRecord[],
  service: readonly UsageBreakdown[],
): UsageBreakdown[] {
  const groups = new Map<string, UsageBreakdown>();
  for (const record of records) {
    const key = record.backend === "projector" ? "chat" : `agent:${record.backend || "unknown"}`;
    const group = groups.get(key) ?? { key, ...emptyTotals() };
    add(group, record);
    groups.set(key, group);
  }
  for (const item of service) {
    const group = groups.get(item.key) ?? { key: item.key, ...emptyTotals() };
    group.input += item.input;
    group.output += item.output;
    group.cacheRead += item.cacheRead;
    group.cacheWrite += item.cacheWrite;
    group.tokens += item.tokens;
    group.answers += item.answers;
    group.cost += item.cost;
    group.pricedAnswers += item.pricedAnswers;
    groups.set(item.key, group);
  }
  return [...groups.values()].sort((a, b) => b.tokens - a.tokens);
}

/**
 * What the chats spent in the range and how full the subscription windows are. Chat usage comes
 * from the saved answers; limit samples are written when an adapter answers a usage request.
 */
export async function usageAnalytics(days: number, now = Date.now()): Promise<UsageAnalytics> {
  const since = rangeStart(now, days);
  const projects = await loadProjects();
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const records = readAgentUsage(since).filter((record) => record.at >= since);
  const service = taskSpend(since);

  const totals = emptyTotals();
  const daily = new Map(daysOf(since, days).map((day) => [day.day, day]));
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
  };
}
