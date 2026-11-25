/** Record builders and small formatting helpers for the trajectory projection. */

import { toolLabel } from "../../agent-core/index.ts";
import type { AgentToolChip, AgentUsage } from "../../agent-core/index.ts";
import type { TrajectoryRecord, TrajectoryTask, TrajectoryUsage } from "./types.ts";

/** A short single-line preview for a ledger row; the full text stays in `detail`. */
export function trajectoryPreview(text: string | undefined, limit = 180): string {
  if (!text) return "";
  const flat = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** The first line of a message, bounded to a title length. */
export function firstLine(text: string | undefined, limit = 72): string {
  const flat = text?.replace(/\s+/g, " ").trim() ?? "";
  if (!flat) return "";
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** Convert the chat's token record into the panel's disjoint buckets. */
export function usageOf(usage: AgentUsage | undefined): TrajectoryUsage | undefined {
  if (!usage) return undefined;
  return {
    ...(Number.isFinite(usage.input) ? { input: usage.input } : {}),
    ...(Number.isFinite(usage.output) ? { output: usage.output } : {}),
    ...(Number.isFinite(usage.cacheRead) ? { cacheRead: usage.cacheRead } : {}),
    ...(Number.isFinite(usage.cacheWrite) ? { cacheWrite: usage.cacheWrite } : {}),
    ...(usage.cost !== undefined && Number.isFinite(usage.cost) ? { cost: usage.cost } : {}),
  };
}

/** Sum two token records, keeping a missing bucket missing instead of zero. */
export function addUsage(
  total: TrajectoryUsage,
  next: TrajectoryUsage | undefined,
): TrajectoryUsage {
  if (!next) return total;
  const sum = (left: number | undefined, right: number | undefined) =>
    left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
  return {
    input: sum(total.input, next.input),
    output: sum(total.output, next.output),
    cacheRead: sum(total.cacheRead, next.cacheRead),
    cacheWrite: sum(total.cacheWrite, next.cacheWrite),
    cost: sum(total.cost, next.cost),
  };
}

/** Own duration from two recorded ends, or `undefined` when either is absent. */
export function durationOf(
  startedAt: number | undefined,
  endedAt: number | undefined,
): number | undefined {
  if (startedAt === undefined || endedAt === undefined) return undefined;
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return undefined;
  return Math.max(0, endedAt - startedAt);
}

/** A tool call as a ledger record: stable `tool:<id>` identity, own times and full output. */
export function toolRecord(tool: AgentToolChip): TrajectoryRecord {
  const label = toolLabel(tool.name, tool.input ?? tool.detail, {
    ...(tool.label === undefined ? {} : { label: tool.label }),
    ...(tool.kind === undefined ? {} : { kind: tool.kind }),
  });
  const preview = trajectoryPreview(tool.detail);
  const duration = durationOf(tool.startedAt, tool.endedAt);
  return {
    id: `tool:${tool.id}`,
    kind: tool.parent ? "subtool" : "tool",
    turn: 0,
    title: label || "Инструмент",
    ...(preview ? { text: preview } : {}),
    detail: tool.detail,
    ...(tool.input === undefined ? {} : { input: tool.input }),
    ...(tool.output === undefined ? {} : { output: tool.output }),
    status: tool.status,
    ...(tool.startedAt === undefined ? {} : { startedAt: tool.startedAt }),
    ...(tool.endedAt === undefined ? {} : { endedAt: tool.endedAt }),
    ...(duration === undefined ? {} : { durationMs: duration }),
    callId: tool.id,
    ...(tool.parent === undefined ? {} : { parentId: tool.parent }),
    tool: {
      id: tool.id,
      name: tool.name,
      status: tool.status,
      detail: tool.detail,
      ...(tool.input === undefined ? {} : { input: tool.input }),
      ...(tool.output === undefined ? {} : { output: tool.output }),
      ...(tool.kind === undefined ? {} : { kind: tool.kind }),
      ...(tool.label === undefined ? {} : { label: tool.label }),
      ...(tool.paths === undefined ? {} : { paths: tool.paths }),
      ...(tool.parent === undefined ? {} : { parent: tool.parent }),
      ...(tool.startedAt === undefined ? {} : { startedAt: tool.startedAt }),
      ...(tool.endedAt === undefined ? {} : { endedAt: tool.endedAt }),
    },
    meta: {
      tool: tool.name,
      ...(tool.kind === undefined ? {} : { kind: tool.kind }),
      ...(tool.paths?.length ? { paths: tool.paths.join(", ") } : {}),
    },
  };
}

/** A subagent or background command as a ledger record. */
export function taskRecord(task: TrajectoryTask): TrajectoryRecord {
  const title =
    task.title ||
    (task.kind === "agent" ? "Субагент" : task.kind === "shell" ? "Фоновая команда" : "Задача");
  const detail = [task.summary, task.prompt, ...(task.log ?? [])].filter(Boolean).join("\n");
  const duration = durationOf(task.startedAt, task.endedAt);
  return {
    id: `task:${task.id}`,
    kind: "task",
    turn: 0,
    title,
    ...(detail ? { text: trajectoryPreview(detail) } : {}),
    ...(detail ? { detail } : {}),
    status: task.status,
    ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
    ...(task.endedAt === undefined ? {} : { endedAt: task.endedAt }),
    ...(duration === undefined ? {} : { durationMs: duration }),
    ...(task.tool === undefined ? {} : { parentId: task.tool }),
    task,
    meta: {
      kind: task.kind,
      ...(task.background === undefined ? {} : { background: task.background }),
      ...(task.subagent === undefined ? {} : { subagent: task.subagent }),
      ...(task.model === undefined ? {} : { model: task.model }),
      ...(task.tools === undefined ? {} : { tools: task.tools }),
      ...(task.tokens === undefined ? {} : { tokens: task.tokens }),
    },
  };
}
