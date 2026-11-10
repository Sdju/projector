import { isAbsolute, relative, resolve } from "node:path";
import type {
  UsageAnalytics,
  UsageBreakdown,
  UsageCostSource,
  UsageDay,
  UsageTotals,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
import { readAgentUsage, type AgentUsageRecord } from "../agent/index.ts";
import { loadProjects } from "../projects/index.ts";
import { readLimitSeries } from "./limits.ts";
import { readProviderSpend } from "./providers.ts";
import { refreshUsageLogs } from "./logs.ts";
import { dayKey, dayStart, readUsageDayTotals } from "./log-days.ts";
import { readUsageSources } from "./log-store.ts";
import { taskSpend } from "../spend/index.ts";

/** One event in the analytics scale, whether it came from a chat answer or a native journal. */
interface UsageRecord {
  backend: string;
  project: string;
  at: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost?: number;
  costSource: UsageCostSource;
  model?: string;
  /** One chat answer has one; a precomputed day bucket has the number it summed. */
  answers?: number;
  pricedAnswers?: number;
  recordedCost?: number;
  computedCost?: number;
}

const emptyTotals = (): UsageTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  tokens: 0,
  answers: 0,
  cost: 0,
  pricedAnswers: 0,
  recordedCost: 0,
  computedCost: 0,
});

function add(totals: UsageTotals, record: UsageRecord): void {
  totals.input += record.input;
  totals.output += record.output;
  totals.cacheRead += record.cacheRead;
  totals.cacheWrite += record.cacheWrite;
  totals.tokens += record.input + record.output + record.cacheRead + record.cacheWrite;
  totals.answers += record.answers ?? 1;
  const priced = record.pricedAnswers ?? (record.cost !== undefined ? 1 : 0);
  if (record.cost !== undefined && priced > 0) {
    totals.cost += record.cost;
    totals.pricedAnswers += priced;
    if (record.recordedCost !== undefined || record.computedCost !== undefined) {
      totals.recordedCost += record.recordedCost ?? 0;
      totals.computedCost += record.computedCost ?? 0;
    } else if (record.costSource === "recorded") totals.recordedCost += record.cost;
    else totals.computedCost += record.cost;
  }
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
  records: readonly UsageRecord[],
  keyOf: (record: UsageRecord) => string,
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
  records: readonly UsageRecord[],
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
    group.recordedCost += item.recordedCost;
    group.computedCost += item.computedCost;
    groups.set(item.key, group);
  }
  return [...groups.values()].sort((a, b) => b.tokens - a.tokens);
}

/** A chat answer's cost, when present, was computed by Projector from the model's tariff. */
function chatRecord(record: AgentUsageRecord): UsageRecord {
  return { ...record, costSource: record.cost !== undefined ? "computed" : "none" };
}

/** The longest matching project path wins, so nested projects do not steal each other's logs. */
function projectLocator(
  projects: Awaited<ReturnType<typeof loadProjects>>,
): (cwd: string) => string {
  const known = projects
    .filter((project) => project.path)
    .map((project) => ({ id: project.id, path: resolve(project.path) }))
    .sort((a, b) => b.path.length - a.path.length);
  return (cwd) => {
    if (!cwd) return "";
    const full = resolve(cwd);
    for (const project of known) {
      const rest = relative(project.path, full);
      if (!rest || (!rest.startsWith("..") && !isAbsolute(rest))) return project.id;
    }
    return "";
  };
}

/**
 * What the chats spent in the range and how full the subscription windows are. Usage comes from
 * the saved answers and the agents' native journals; journals are scanned incrementally, so a
 * second look at the same range reads only files that changed.
 */
export async function usageAnalytics(days: number, now = Date.now()): Promise<UsageAnalytics> {
  const since = rangeStart(now, days);
  const projects = await loadProjects();
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const locate = projectLocator(projects);
  await refreshUsageLogs(since, now);
  const records: UsageRecord[] = readAgentUsage(since)
    .filter((record) => record.at >= since)
    .map(chatRecord);
  const nativeCounts = new Map<string, { events: number; recorded: number; unpriced: number }>();
  for (const row of readUsageDayTotals(dayKey(since))) {
    const counts = nativeCounts.get(row.backend) ?? { events: 0, recorded: 0, unpriced: 0 };
    counts.events += row.answers;
    counts.recorded += row.pricedAnswers;
    counts.unpriced += Math.max(0, row.answers - row.pricedAnswers);
    nativeCounts.set(row.backend, counts);
    records.push({
      backend: row.backend,
      project: locate(row.place),
      at: dayStart(row.day),
      input: row.input,
      output: row.output,
      cacheRead: row.cacheRead,
      cacheWrite: row.cacheWrite,
      ...(row.pricedAnswers > 0 ? { cost: row.cost } : {}),
      costSource: row.pricedAnswers === 0 ? "none" : row.recordedCost > 0 ? "recorded" : "computed",
      ...(row.model ? { model: row.model } : {}),
      answers: row.answers,
      pricedAnswers: row.pricedAnswers,
      recordedCost: row.recordedCost,
      computedCost: row.computedCost,
    });
  }
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
