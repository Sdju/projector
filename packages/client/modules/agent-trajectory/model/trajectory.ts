/** Projects the chat's current turns into the backend-independent trajectory data. */

import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";
import { legacyParts } from "../../agent-core/index.ts";
import type { AgentPart, AgentTurn } from "../../agent-core/index.ts";
import {
  addUsage,
  firstLine,
  taskRecord,
  toolRecord,
  trajectoryPreview,
  usageOf,
} from "./records.ts";
import type {
  TrajectoryCapabilities,
  TrajectoryCounts,
  TrajectoryData,
  TrajectoryRecord,
  TrajectoryRecordStatus,
  TrajectoryTurn,
  TrajectoryUsage,
} from "./types.ts";

/** Knobs for the current chat projection; a different source passes its own notice. */
export interface TrajectoryProjectionOptions {
  /** The answer is still being written, so its last turn is running. */
  busy?: boolean;
  /** Replaces the default explanation of the fields this source cannot fill yet. */
  notice?: string;
}

const DEFAULT_NOTICE =
  "Показаны ходы, текст, инструменты и usage. Шаги модели, TTFT и системный контекст появятся, когда источник начнёт их отдавать.";

function emptyCapabilities(): TrajectoryCapabilities {
  return {
    steps: false,
    ttft: false,
    tools: false,
    tasks: false,
    usage: false,
    costs: false,
    context: false,
    compaction: false,
    live: false,
  };
}

function emptyCounts(): TrajectoryCounts {
  return { turns: 0, records: 0, tools: 0, tasks: 0, errors: 0, running: 0 };
}

function turnStatus(turn: AgentTurn, running: boolean): TrajectoryRecordStatus {
  if (turn.failure || turn.failureInfo) return "error";
  if (turn.stopped) return "stopped";
  return running ? "running" : "done";
}

function addRecord(turn: TrajectoryTurn, record: TrajectoryRecord, counts: TrajectoryCounts) {
  record.turn = turn.number;
  turn.records.push(record);
  counts.records++;
  if (record.kind === "tool" || record.kind === "subtool") counts.tools++;
  if (record.kind === "task") counts.tasks++;
  if (record.status === "error") counts.errors++;
  if (record.status === "running") counts.running++;
}

/** The context Projector itself put before a native session's first user message. */
function contextRecord(turn: AgentTurn): TrajectoryRecord | undefined {
  if (!turn.injected?.trim()) return undefined;
  return {
    id: `context:${turn.id}`,
    kind: "context",
    turn: 0,
    title: "Инструкции Projector",
    text: trajectoryPreview(turn.injected),
    detail: turn.injected,
    status: "done",
    ...(turn.at === undefined ? {} : { startedAt: turn.at }),
  };
}

function userRecord(turn: AgentTurn, title: string): TrajectoryRecord {
  return {
    id: `user:${turn.id}`,
    kind: "user",
    turn: 0,
    title,
    text: trajectoryPreview(turn.text),
    detail: turn.text,
    status: "done",
    ...(turn.at === undefined ? {} : { startedAt: turn.at }),
    meta: {
      ...(turn.form === undefined ? {} : { form: true }),
      ...(turn.auto === undefined ? {} : { auto: turn.autoTitle ?? turn.auto }),
      ...(turn.content?.length ? { attachments: turn.content.length } : {}),
    },
  };
}

function partRecord(
  turn: AgentTurn,
  part: AgentPart,
  index: number,
  status: TrajectoryRecordStatus,
): TrajectoryRecord | undefined {
  const start = turn.at;
  if (part.type === "text") {
    if (!part.text.trim()) return undefined;
    return {
      id: `answer:${turn.id}:${index}`,
      kind: "assistant",
      turn: 0,
      title: "Ответ",
      text: trajectoryPreview(part.text),
      detail: part.text,
      status,
      ...(start === undefined ? {} : { startedAt: start }),
    };
  }
  if (part.type === "thought") {
    if (!part.text.trim()) return undefined;
    return {
      id: `thought:${turn.id}:${index}`,
      kind: "thought",
      turn: 0,
      title: "Размышление",
      text: trajectoryPreview(part.text),
      detail: part.text,
      status,
      ...(start === undefined ? {} : { startedAt: start }),
    };
  }
  if (part.type === "note") {
    return {
      id: `note:${turn.id}:${index}`,
      kind: "note",
      turn: 0,
      title: "Заметка",
      text: trajectoryPreview(part.text),
      detail: part.text,
      status: "done",
      ...(start === undefined ? {} : { startedAt: start }),
    };
  }
  if (part.type === "judge") {
    return {
      id: `judge:${turn.id}:${index}`,
      kind: "judge",
      turn: 0,
      title: part.title || "Решение судьи",
      text: trajectoryPreview(part.verdict.reason),
      detail: [part.verdict.label, part.verdict.reason].filter(Boolean).join(" · "),
      status: "done",
      startedAt: part.at,
      meta: {
        decision: part.decision,
        score: part.verdict.score,
        label: part.verdict.label,
      },
    };
  }
  return undefined;
}

function failureRecord(turn: AgentTurn): TrajectoryRecord | undefined {
  if (!turn.failure && !turn.failureInfo) return undefined;
  const message = turn.failureInfo?.message ?? turn.failure ?? "Ответ не получен";
  return {
    id: `error:${turn.id}`,
    kind: "note",
    turn: 0,
    title: "Ошибка",
    text: trajectoryPreview(message),
    detail: message,
    status: "error",
    ...(turn.at === undefined ? {} : { startedAt: turn.at }),
  };
}

/**
 * Build the panel's data from the turns a chat already has.
 *
 * One assistant turn is one answer; without step events its text, thoughts, calls and tasks are
 * separate records. Everything the chat did not record (TTFT, request boundaries, system prompt)
 * stays absent and is named in `notice`, rather than being inferred.
 */
export function trajectoryFromTurns(
  turns: readonly AgentTurn[],
  options: TrajectoryProjectionOptions = {},
): TrajectoryData {
  const projected: TrajectoryTurn[] = [];
  const records: TrajectoryRecord[] = [];
  const counts = emptyCounts();
  const capabilities = emptyCapabilities();
  let usage: TrajectoryUsage = {};
  let request = 0;
  let current: TrajectoryTurn | undefined;
  const lastAssistant = turns.findLast((turn) => turn.role === "assistant");

  for (const turn of turns) {
    if (turn.role === "user") {
      request++;
      const title = firstLine(turn.text) || `Запрос ${request}`;
      current = {
        number: request,
        id: turn.id,
        title,
        ...(turn.at === undefined ? {} : { startedAt: turn.at }),
        status: "done",
        records: [],
      };
      projected.push(current);
      counts.turns++;
      const context = contextRecord(turn);
      if (context) addRecord(current, context, counts);
      addRecord(current, userRecord(turn, title), counts);
      continue;
    }

    if (current === undefined) {
      current = {
        number: 0,
        id: turn.id,
        title: "Ответ без запроса",
        ...(turn.at === undefined ? {} : { startedAt: turn.at }),
        status: "done",
        records: [],
      };
      projected.push(current);
      counts.turns++;
    }
    const owner = current;
    const running = options.busy === true && turn === lastAssistant;
    const answerStatus = turnStatus(turn, running);
    owner.status = answerStatus;
    if (turn.usage) {
      const turnUsage = usageOf(turn.usage);
      owner.usage = turnUsage;
      usage = addUsage(usage, turnUsage);
      capabilities.usage = true;
      if (turnUsage?.cost !== undefined) capabilities.costs = true;
    }
    if (turn.context) {
      owner.context = turn.context;
      capabilities.context = true;
    }

    const parts: readonly AgentPart[] = turn.parts ?? legacyParts(turn);
    const seen = new Set<string>();
    let answered = false;

    for (const [index, part] of parts.entries()) {
      if (part.type === "tool") {
        seen.add(part.id);
        const tool = turn.tools.find((item) => item.id === part.id);
        if (tool) {
          addRecord(owner, toolRecord(tool), counts);
          capabilities.tools = true;
        }
        continue;
      }
      const record = partRecord(turn, part, index, answerStatus);
      if (!record) continue;
      if (record.kind === "assistant") answered = true;
      addRecord(owner, record, counts);
    }

    for (const tool of turn.tools) {
      if (seen.has(tool.id)) continue;
      addRecord(owner, toolRecord(tool), counts);
      capabilities.tools = true;
    }
    for (const task of turn.tasks ?? []) {
      addRecord(owner, taskRecord(task), counts);
      capabilities.tasks = true;
      if (task.status === "running") capabilities.live = true;
    }
    if (!answered && running) {
      addRecord(
        owner,
        {
          id: `answer:${turn.id}:pending`,
          kind: "assistant",
          turn: owner.number,
          title: "Ответ",
          status: "running",
          ...(turn.at === undefined ? {} : { startedAt: turn.at }),
        },
        counts,
      );
    }
    const failure = failureRecord(turn);
    if (failure) addRecord(owner, failure, counts);
    if (running) capabilities.live = true;
  }

  for (const turn of projected) {
    for (const record of turn.records) records.push(record);
  }
  if (
    usage.input === undefined &&
    usage.output === undefined &&
    usage.cacheRead === undefined &&
    usage.cacheWrite === undefined &&
    usage.cost === undefined
  )
    usage = {};

  return {
    turns: projected,
    records,
    counts,
    usage,
    capabilities,
    notice: options.notice ?? DEFAULT_NOTICE,
  };
}

/** Reactive form used by a chat view: recomputes only when the turns or busy flag change. */
export function useTrajectoryData(
  turns: MaybeRefOrGetter<readonly AgentTurn[]>,
  options: MaybeRefOrGetter<TrajectoryProjectionOptions> = {},
): ComputedRef<TrajectoryData> {
  return computed(() => trajectoryFromTurns(toValue(turns), toValue(options)));
}
