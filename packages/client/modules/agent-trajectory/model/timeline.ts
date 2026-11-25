/**
 * Pure projection of trajectory records into the overview strip.
 *
 * `sequence` gives every record the same width. `duration` keeps recorded start times, compresses
 * idle gaps and uses recorded durations; a record without one stays a point rather than getting an
 * invented width.
 */

import type { TrajectoryData, TrajectoryRecord, TrajectoryRecordKind } from "./types.ts";

export type TrajectoryScale = "sequence" | "duration";

/** An inclusive interval in the active projection's domain. */
export interface TrajectoryTimeRange {
  start: number;
  end: number;
}

/** One record in the active projection. */
export interface TrajectorySpan {
  record: TrajectoryRecord;
  index: number;
  start: number;
  end: number;
  lane: 0 | 1 | 2;
}

/** A vertical marker at the first record of a turn. */
export interface TrajectoryBoundary {
  turn: number;
  time: number;
}

export interface TrajectoryTimeline {
  start: number;
  end: number;
  spans: readonly TrajectorySpan[];
  boundaries: readonly TrajectoryBoundary[];
  /** At least one record carries a recorded duration. */
  hasDuration: boolean;
}

/** The three lanes of the overview: input, model work and tools. */
export function trajectoryLane(kind: TrajectoryRecordKind): 0 | 1 | 2 {
  if (kind === "tool" || kind === "subtool" || kind === "task") return 2;
  if (kind === "assistant" || kind === "thought" || kind === "compaction") return 1;
  return 0;
}

/** Whether a duration projection has anything to place. */
export function hasTimedRecords(data: TrajectoryData): boolean {
  return data.records.some(
    (record) => record.startedAt !== undefined && Number.isFinite(record.startedAt),
  );
}

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function sequenceTimeline(records: readonly TrajectoryRecord[]): TrajectoryTimeline | null {
  if (records.length === 0) return null;
  const spans: TrajectorySpan[] = records.map((record, index) => ({
    record,
    index,
    start: index,
    end: index + 1,
    lane: trajectoryLane(record.kind),
  }));
  const seen = new Set<number>();
  const boundaries: TrajectoryBoundary[] = [];
  for (const [index, record] of records.entries()) {
    if (seen.has(record.turn)) continue;
    seen.add(record.turn);
    boundaries.push({ turn: record.turn, time: index });
  }
  return {
    start: 0,
    end: records.length,
    spans,
    boundaries,
    hasDuration: records.some((record) => finite(record.durationMs)),
  };
}

function durationTimeline(records: readonly TrajectoryRecord[]): TrajectoryTimeline | null {
  const raw = records.flatMap((record, index): TrajectorySpan[] => {
    if (!finite(record.startedAt)) return [];
    const duration = finite(record.durationMs) ? Math.max(0, record.durationMs) : 0;
    return [
      {
        record,
        index,
        start: record.startedAt,
        end: record.startedAt + duration,
        lane: trajectoryLane(record.kind),
      },
    ];
  });
  if (raw.length === 0) return null;

  // Idle time between operations is dead space in a chat timeline: remove it, but keep overlaps
  // (parallel calls) and every recorded duration intact.
  const ordered = [...raw].sort((left, right) => left.start - right.start || left.end - right.end);
  const removedIdleBySpan = new Map<TrajectorySpan, number>();
  let removedIdle = 0;
  let coveredUntil: number | null = null;
  for (const span of ordered) {
    if (coveredUntil !== null && span.start > coveredUntil)
      removedIdle += span.start - coveredUntil;
    removedIdleBySpan.set(span, removedIdle);
    coveredUntil = coveredUntil === null ? span.end : Math.max(coveredUntil, span.end);
  }

  const spans: TrajectorySpan[] = raw.map((span) => {
    const offset = removedIdleBySpan.get(span) ?? 0;
    return {
      ...span,
      start: span.start - offset,
      end: Math.max(span.start, span.end) - offset,
    };
  });
  const start = Math.min(...spans.map((span) => span.start));
  const end = Math.max(...spans.map((span) => span.end));
  const seen = new Set<number>();
  const boundaries: TrajectoryBoundary[] = [];
  for (const span of spans) {
    if (seen.has(span.record.turn)) continue;
    seen.add(span.record.turn);
    boundaries.push({ turn: span.record.turn, time: span.start });
  }
  return {
    start,
    end: end > start ? end : start + 1,
    spans,
    boundaries,
    hasDuration: spans.some((span) => span.end > span.start),
  };
}

/** Build the overview model, or `null` when there is nothing to draw. */
export function deriveTrajectoryTimeline(
  data: TrajectoryData,
  scale: TrajectoryScale = "sequence",
): TrajectoryTimeline | null {
  return scale === "duration" ? durationTimeline(data.records) : sequenceTimeline(data.records);
}

/** Records active at any point inside the inclusive selected interval. */
export function trajectoryFocusIds(
  data: TrajectoryData,
  range: TrajectoryTimeRange | null,
  scale: TrajectoryScale,
): ReadonlySet<string> | null {
  if (range === null) return null;
  const model = deriveTrajectoryTimeline(data, scale);
  if (model === null) return new Set();
  return new Set(
    model.spans
      .filter((span) => span.start <= range.end && span.end >= range.start)
      .map((span) => span.record.id),
  );
}
