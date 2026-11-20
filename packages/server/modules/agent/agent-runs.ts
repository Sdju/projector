import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { os } from "@ai-projector/core/modules/os/index.ts";
import type { AgentBackendId } from "./backend.ts";
import { runsChanged } from "./change-events.ts";
import { recordRecentRun } from "./recent-runs.ts";
import { parseRunRecord, type AgentRunRecord } from "./run-record.ts";
import { readStateFile } from "./state-file.ts";
import { pendingRunRequests, type RunPending } from "./run-hub.ts";

export type { AgentRunRecord } from "./run-record.ts";

/** A run whose agent process is alive, for the overview of what works now. */
export interface LiveRun {
  id: string;
  backend: AgentBackendId;
  projectId: string;
  chat: string;
  topic: string;
  status: "running" | "needs-user";
  pending: RunPending[];
  /** The agent's own session, if it reported it already. */
  session?: string;
  /** When the run started (ms since the epoch). */
  startedAt?: number;
}

/** Runs with a live host, whichever page started them. */
export async function listLiveRuns(): Promise<LiveRun[]> {
  const ids = await readdir(runsRoot()).catch(() => [] as string[]);
  const runs = await Promise.all(
    ids
      .filter((id) => RUN_ID.test(id))
      .map(async (id): Promise<LiveRun | undefined> => {
        if ((await liveHost(id)) === undefined) return;
        const record = await readRun(id);
        // A background job shows up as a job, not as a second run.
        if (!record || record.chat?.startsWith(JOB_CHAT)) return;
        // A run started before its record carried the time: the file's own time is close enough.
        const startedAt =
          record.startedAt ??
          (await stat(join(runDirectory(id), "run.json")).catch(() => null))?.mtimeMs;
        const pending = pendingRunRequests(id);
        return {
          id,
          backend: record.backend,
          projectId: record.projectId ?? "",
          chat: record.chat ?? "",
          topic: record.message.trim().slice(0, 120),
          status: pending.length ? "needs-user" : "running",
          pending,
          ...(record.session ? { session: record.session } : {}),
          ...(startedAt !== undefined ? { startedAt } : {}),
        };
      }),
  );
  return runs.filter((run): run is LiveRun => !!run);
}

/** Checks persisted ownership too, so a restarted server cannot start a competing native session. */
export async function hasLiveSession(
  backend: AgentBackendId,
  session: string,
  except?: string,
): Promise<boolean> {
  const ids = await readdir(runsRoot()).catch(() => [] as string[]);
  const owners = await Promise.all(
    ids
      .filter((id) => RUN_ID.test(id) && id !== except)
      .map(async (id) => {
        const run = await readRun(id);
        return (
          run?.backend === backend &&
          (run.session ?? run.sessionId) === session &&
          (await liveHost(id)) !== undefined
        );
      }),
  );
  return owners.some(Boolean);
}

/** The `chat` of a run that belongs to a background job (`job:<id>`). */
export const JOB_CHAT = "job:";
const RUN_ID = /^[0-9a-f]{12}$/;
/** A host still alive after this long is stopped and its run removed. */
const RUN_TTL_MS = 24 * 60 * 60 * 1000;
/** A finished run nobody rejoined is kept this long, then removed. */
const RETAIN_MS = 60 * 60 * 1000;
/** The run of a background job waits longer: a restarted server rejoins it to collect the answer. */
const JOB_RETAIN_MS = 24 * 60 * 60 * 1000;

const runsRoot = () => join(dataDir(), "agent", "runs");

/** The directory of a run; the identifier comes from a client, so its shape is checked. */
export function runDirectory(id: string): string {
  if (!RUN_ID.test(id)) throw new Error("Некорректный идентификатор хода");
  return join(runsRoot(), id);
}

export async function createRun(record: AgentRunRecord): Promise<string> {
  const id = randomBytes(6).toString("hex");
  const dir = runDirectory(id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, "run.json"), JSON.stringify({ ...record, startedAt: Date.now() }), {
    mode: 0o600,
  });
  runsChanged();
  return id;
}

export async function readRun(id: string): Promise<AgentRunRecord | null> {
  // Идентификатор приходит от клиента: негодный — это отсутствующий ход, а не ошибка.
  if (!RUN_ID.test(id)) return null;
  const read = await readStateFile(join(runDirectory(id), "run.json"), "Файл хода", parseRunRecord);
  return read.status === "ok" ? read.value : null;
}

/** Notes the agent's session in the stored run. */
export async function rememberSession(id: string, session: string): Promise<void> {
  const record = await readRun(id);
  if (!record || record.session === session) return;
  await writeFile(join(runDirectory(id), "run.json"), JSON.stringify({ ...record, session }), {
    mode: 0o600,
  });
}

/**
 * A disconnected/replaced reader must never erase a run that still has a live owner.
 * A soft keep-alive marker means the host still needs its directory after `done`: deleting the
 * marker would make the host SIGTERM a background task that was deliberately kept alive.
 */
export async function removeRun(id: string, options: { force?: boolean } = {}): Promise<boolean> {
  const dir = runDirectory(id);
  if (!options.force && existsSync(join(dir, "keep-alive"))) return false;
  if ((await liveHost(id)) !== undefined) return false;
  // A deep data directory puts the socket in /tmp instead (see `agentHostAddress`).
  await os.tools.removeAgentHostAddress(dir, os.tools.agentHostAddress(dir));
  // A host that was just signalled may still write; retry instead of failing on ENOTEMPTY.
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  runsChanged();
  return true;
}

/** The host's process identity, so a pid reused by another program later is never signalled. */
export async function rememberHost(id: string, pid: number): Promise<void> {
  const identity = await os.processes.identity(pid);
  await writeFile(join(runDirectory(id), "process.json"), JSON.stringify({ pid, identity }));
}

async function liveHost(id: string): Promise<number | undefined> {
  try {
    const { pid, identity } = JSON.parse(
      await readFile(join(runDirectory(id), "process.json"), "utf8"),
    );
    return Number.isInteger(pid) && identity && (await os.processes.identity(pid)) === identity
      ? pid
      : undefined;
  } catch {
    return undefined;
  }
}

/** Stops a run's agent and everything it started, whichever server started it. */
export async function stopRun(id: string): Promise<void> {
  const pid = await liveHost(id);
  if (!pid) return;
  os.tools.killAgentTree(pid);
  await waitRunExit(id);
}

export async function waitRunExit(id: string): Promise<void> {
  // Signalling is asynchronous: keep the record until the host actually releases the run.
  const deadline = Date.now() + 5000;
  while ((await liveHost(id)) !== undefined && Date.now() < deadline) await sleep(25);
}

/**
 * Drops what nobody will come back for. A finished run (its host is gone) is kept for
 * `RETAIN_MS` so a reopened page can still replay the answer; a host that outlived `RUN_TTL_MS`
 * is stopped first. Runs are collected at server start, whenever a new run starts, and one
 * `RETAIN_MS` after a run ended unseen, so a crash or a closed page leaves nothing behind.
 */
export async function pruneRuns(now = Date.now()): Promise<void> {
  const ids = await readdir(runsRoot()).catch(() => [] as string[]);
  for (const id of ids) {
    if (!RUN_ID.test(id)) continue;
    const dir = runDirectory(id);
    const last = await Promise.all(
      ["trace.log", "run.json"].map((name) => stat(join(dir, name)).catch(() => null)),
    ).then((found) => found.find(Boolean)?.mtimeMs ?? 0);
    const age = now - last;
    if ((await liveHost(id)) !== undefined) {
      if (age < RUN_TTL_MS) continue;
      await stopRun(id);
    } else {
      const job = (await readRun(id))?.chat?.startsWith(JOB_CHAT);
      if (age < (job ? JOB_RETAIN_MS : RETAIN_MS)) continue;
    }
    await removeRun(id, { force: true }).catch(() => {});
  }
}

/** Collect finished runs once their retention has passed. */
export function schedulePrune(): void {
  setTimeout(() => void pruneRuns().catch(() => {}), RETAIN_MS + 1000).unref();
}

const host = globalThis as typeof globalThis & {
  projectorAgentRuns?: Map<string, () => void>;
};
const active = (host.projectorAgentRuns ??= new Map<string, () => void>());

/** Registers how to cancel a run this server is driving; the returned function forgets it. */
export function trackRun(id: string, cancel: () => void): () => void {
  active.set(id, cancel);
  return () => {
    if (active.get(id) === cancel) active.delete(id);
  };
}

/** The user pressed stop: cancel the run here, or stop the agent a former server started. */
export async function cancelRun(id: string): Promise<void> {
  const cancel = active.get(id);
  if (cancel) return cancel();
  const record = await readRun(id);
  await stopRun(id);
  if (record && !record.chat?.startsWith(JOB_CHAT)) {
    await recordRecentRun({
      id,
      backend: record.backend,
      projectId: record.projectId ?? "",
      chat: record.chat ?? "",
      topic: record.message.trim().slice(0, 120),
      status: "stopped",
      ...(record.session ? { session: record.session } : {}),
      startedAt: record.startedAt ?? Date.now(),
      endedAt: Date.now(),
    }).catch(() => {});
  }
  await removeRun(id, { force: true });
}
