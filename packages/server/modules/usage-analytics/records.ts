import { isAbsolute, relative, resolve } from "node:path";
import type {
  UsageBreakdown,
  UsageCostSource,
  UsageHour,
  UsageTotals,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
import type { AgentUsageRecord } from "../agent/index.ts";
import type { loadProjects } from "../projects/index.ts";
import { dayStart, type UsageDayTotal } from "./log-days.ts";
import type { UsageEventRow } from "./log-store.ts";

/** One event in the analytics scale, whether it came from a chat answer or a native journal. */
export interface UsageRecord {
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

export const emptyTotals = (): UsageTotals => ({
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

export function add(totals: UsageTotals, record: UsageRecord): void {
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

export function breakdown(
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
export function taskBreakdown(
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
export function chatRecord(record: AgentUsageRecord): UsageRecord {
  return { ...record, costSource: record.cost !== undefined ? "computed" : "none" };
}

/** One native journal event with its real timestamp, so the day chart keeps the hour. */
export function eventRecord(row: UsageEventRow, locate: (cwd: string) => string): UsageRecord {
  return {
    backend: row.agent,
    project: locate(row.cwd),
    at: row.at,
    input: row.input,
    output: row.output,
    cacheRead: row.cacheRead,
    cacheWrite: row.cacheWrite,
    ...(row.cost !== null ? { cost: row.cost } : {}),
    costSource: row.costSource,
    ...(row.model ? { model: row.model } : {}),
  };
}

/** 24 local hours with zero totals; the date constructor keeps DST from shifting the labels. */
export function emptyHours(day: string): UsageHour[] {
  const [year, month, date] = day.split("-").map(Number);
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    at: new Date(year!, month! - 1, date!, hour).getTime(),
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 0,
    answers: 0,
    cost: 0,
  }));
}

/** The day split by local hour; a repeated DST hour lands in the bucket of its first pass. */
export function hourly(records: readonly UsageRecord[], day: string): UsageHour[] {
  const hours = emptyHours(day);
  for (const record of records) {
    const bucket = hours[new Date(record.at).getHours()];
    if (!bucket) continue;
    bucket.input += record.input;
    bucket.output += record.output;
    bucket.cacheRead += record.cacheRead;
    bucket.cacheWrite += record.cacheWrite;
    bucket.tokens += record.input + record.output + record.cacheRead + record.cacheWrite;
    bucket.answers += record.answers ?? 1;
    if (record.cost !== undefined) bucket.cost += record.cost;
  }
  return hours;
}

/** A precomputed day of native journal rows as one analytics event. */
export function nativeRecord(row: UsageDayTotal, locate: (cwd: string) => string): UsageRecord {
  return {
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
  };
}

/** The longest matching project path wins, so nested projects do not steal each other's logs. */
export function projectLocator(
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
