import { isJudgeVerdict, type JudgeVerdict } from "@ai-projector/core/modules/agent-judge/index.ts";
import { runsChanged } from "./change-events.ts";
import {
  isBridgeRequestPending,
  type AgentQuestion,
  type SecretDestination,
} from "./command-bridge.ts";

/** A page watching a run: its own event stream and how to tell it the answer is over. */
export interface RunViewer {
  emit(event: string, data: unknown): void;
  close(): void;
  /** The page, so a reconnect replaces its old subscription instead of watching twice. */
  key?: string;
}

/** A pending user-facing request of a live run, shown in the notification center. */
export interface RunPending {
  id: string;
  kind: "permission" | "question" | "secret";
  title: string;
  tool?: string;
  detail?: string;
  persistent?: boolean;
  judge?: JudgeVerdict;
  questions?: AgentQuestion[];
  custom?: boolean;
  reason?: string;
  destination?: SecretDestination;
}

/** Events only one page may act on: a command must run once, not in every viewer. */
const ACTIONS = new Set(["command-request"]);
const USER_WAITING = new Set(["permission-request", "question-request", "secret-request"]);
/** Requests waiting for the user: a page that joins late still sees the unanswered ones. */
const WAITING = new Set(["command-request", ...USER_WAITING]);

interface Entry {
  event: string;
  data: unknown;
}

interface Run {
  viewers: Set<RunViewer>;
  /** The page that answers `command-request`; handed to a viewer when the owner leaves. */
  owner: RunViewer | undefined;
  events: Entry[];
  ended: boolean;
  /** A viewer was still connected when the answer ended: nothing is left to rejoin. */
  delivered: boolean;
}

// Vite reloads API modules without closing open answers: keep the runs across reloads.
const host = globalThis as typeof globalThis & {
  projectorRunHub?: Map<string, Run>;
};
const runs = (host.projectorRunHub ??= new Map<string, Run>());

const idOf = (entry: Entry) => String((entry.data as { id?: unknown } | undefined)?.id ?? "");

/** An unanswered request from the agent: the user has not acted on it yet. */
const waiting = (entry: Entry) => WAITING.has(entry.event) && isBridgeRequestPending(idOf(entry));

export interface RunDriver {
  /** Records an event and gives it to every viewer; actions go to the owner only. */
  publish(event: string, data: unknown): void;
  /** Ends the answer for every viewer and frees the run. */
  finish(): void;
  /** The driver page is gone; the run goes on, and the next viewer takes over its actions. */
  leave(): void;
  delivered(): boolean;
}

/** Register the server's own answer for a run; every page watching it subscribes through `joinRun`. */
export function driveRun(id: string, owner: RunViewer): RunDriver {
  const run: Run = {
    viewers: new Set([owner]),
    owner,
    events: [],
    ended: false,
    delivered: false,
  };
  runs.set(id, run);
  return {
    publish(event, data) {
      if (run.ended) return;
      const entry = { event, data };
      run.events.push(entry);
      if (event === "done" || event === "error") run.delivered ||= run.viewers.size > 0;
      if (ACTIONS.has(event)) run.owner?.emit(event, data);
      else for (const viewer of run.viewers) viewer.emit(event, data);
      if (USER_WAITING.has(event)) runsChanged();
    },
    finish() {
      if (run.ended) return;
      const hadWaiting = run.events.some((entry) => USER_WAITING.has(entry.event));
      run.ended = true;
      runs.delete(id);
      for (const viewer of [...run.viewers]) viewer.close();
      run.viewers.clear();
      run.owner = undefined;
      if (hadWaiting) runsChanged();
    },
    leave: () => leave(run, owner),
    delivered: () => run.delivered,
  };
}

/**
 * Follow a run this server is already answering: the whole answer is replayed, then its events
 * come live. Returns how to stop watching, or `undefined` when no such run is being driven here
 * (the page then attaches to the host, and this server takes the run over).
 */
export function joinRun(id: string, viewer: RunViewer): (() => void) | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  // A page that reconnects takes its old subscription's place; an abandoned stream must not keep
  // receiving the run's commands or count as the owner.
  const previous =
    viewer.key === undefined ? undefined : [...run.viewers].find((item) => item.key === viewer.key);
  if (previous) {
    run.viewers.delete(previous);
    if (run.owner === previous) run.owner = undefined;
  }
  for (const entry of run.events) {
    // Commands stay with their owner; unanswered questions are shown to the new page too.
    if (ACTIONS.has(entry.event)) continue;
    if (WAITING.has(entry.event) && !waiting(entry)) continue;
    viewer.emit(entry.event, entry.data);
  }
  run.viewers.add(viewer);
  if (!run.owner) {
    run.owner = viewer;
    replayActions(run, viewer);
  }
  return () => leave(run, viewer);
}

/** Whether this server is already answering the run. */
export function isRunDriven(id: string): boolean {
  return runs.has(id);
}

function previewInput(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input === "string") return input.trim().slice(0, 2000) || undefined;
  try {
    const text = JSON.stringify(input, null, 2);
    return text ? text.slice(0, 2000) : undefined;
  } catch {
    return undefined;
  }
}

/** Unanswered user-facing requests (permissions with Judge, questions, secrets) for a live run. */
export function pendingRunRequests(id: string): RunPending[] {
  const run = runs.get(id);
  if (!run) return [];
  const pending: RunPending[] = [];
  for (const entry of run.events) {
    if (!USER_WAITING.has(entry.event) || !waiting(entry)) continue;
    const data = (entry.data ?? {}) as Record<string, unknown>;
    const requestId = typeof data.id === "string" ? data.id : "";
    if (!requestId) continue;
    if (entry.event === "permission-request") {
      const detail =
        typeof data.detail === "string" && data.detail.trim()
          ? data.detail
          : previewInput(data.input);
      const tool = typeof data.tool === "string" ? data.tool : "";
      const title =
        typeof data.title === "string" && data.title ? data.title : tool || "Разрешение";
      pending.push({
        id: requestId,
        kind: "permission",
        title,
        tool,
        ...(detail ? { detail } : {}),
        persistent: data.persistent === true,
        ...(isJudgeVerdict(data.judge) ? { judge: data.judge } : {}),
      });
    } else if (entry.event === "question-request") {
      const questions = Array.isArray(data.questions) ? (data.questions as AgentQuestion[]) : [];
      pending.push({
        id: requestId,
        kind: "question",
        title: typeof data.title === "string" && data.title ? data.title : "Вопрос агента",
        questions,
        custom: data.custom === true,
      });
    } else if (entry.event === "secret-request") {
      pending.push({
        id: requestId,
        kind: "secret",
        title: typeof data.label === "string" && data.label ? data.label : "Секрет",
        ...(typeof data.reason === "string" && data.reason ? { reason: data.reason } : {}),
        ...(data.destination && typeof data.destination === "object"
          ? { destination: data.destination as SecretDestination }
          : {}),
      });
    }
  }
  return pending;
}

/** A command asked while nobody owned the run: the first page that joins answers it. */
function replayActions(run: Run, viewer: RunViewer) {
  for (const entry of run.events)
    if (ACTIONS.has(entry.event) && waiting(entry)) viewer.emit(entry.event, entry.data);
}

function leave(run: Run, viewer: RunViewer) {
  if (!run.viewers.delete(viewer)) return;
  if (run.owner !== viewer) return;
  run.owner = run.viewers.values().next().value;
  if (run.owner) replayActions(run, run.owner);
}
