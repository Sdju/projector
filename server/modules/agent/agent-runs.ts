import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "../../../core/modules/app-paths/index.ts";
import { os } from "../../../core/modules/os/index.ts";
import type { AgentHistoryTurn } from "../providers/index.ts";
import type { AgentBackendId, AgentPermissionMode } from "./backend.ts";
import type { AgentSelection } from "./controls.ts";

/** What a restarted server needs to repeat a run and so rejoin its answer in progress. */
export interface AgentRunRecord {
  backend: AgentBackendId;
  message: string;
  history: AgentHistoryTurn[];
  cwd?: string;
  sessionId?: string;
  selection?: AgentSelection;
  permissionMode?: AgentPermissionMode;
  providerId?: string;
}

const RUN_ID = /^[0-9a-f]{12}$/;
/** A host still alive after this long is stopped and its run removed. */
const RUN_TTL_MS = 24 * 60 * 60 * 1000;
/** A finished run nobody rejoined is kept this long, then removed. */
const RETAIN_MS = 60 * 60 * 1000;

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
  await writeFile(join(dir, "run.json"), JSON.stringify(record), { mode: 0o600 });
  return id;
}

export async function readRun(id: string): Promise<AgentRunRecord | null> {
  try {
    return JSON.parse(await readFile(join(runDirectory(id), "run.json"), "utf8"));
  } catch {
    return null;
  }
}

export async function removeRun(id: string): Promise<void> {
  const dir = runDirectory(id);
  // A deep data directory puts the socket in /tmp instead (see `agentHostAddress`).
  await os.tools.removeAgentHostAddress(dir, os.tools.agentHostAddress(dir));
  await rm(dir, { recursive: true, force: true });
}

/** The host's process identity, so a pid reused by another program later is never signalled. */
export async function rememberHost(id: string, pid: number): Promise<void> {
  const identity = os.processes.identity(pid);
  await writeFile(join(runDirectory(id), "process.json"), JSON.stringify({ pid, identity }));
}

async function liveHost(id: string): Promise<number | undefined> {
  try {
    const { pid, identity } = JSON.parse(
      await readFile(join(runDirectory(id), "process.json"), "utf8"),
    );
    return Number.isInteger(pid) && identity && os.processes.identity(pid) === identity
      ? pid
      : undefined;
  } catch {
    return undefined;
  }
}

/** Stops a run's agent and everything it started, whichever server started it. */
export async function stopRun(id: string): Promise<void> {
  const pid = await liveHost(id);
  if (pid) os.tools.killAgentTree(pid);
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
    } else if (age < RETAIN_MS) continue;
    await removeRun(id).catch(() => {});
  }
}

/** Collect finished runs once their retention has passed. */
export function schedulePrune(): void {
  setTimeout(() => void pruneRuns().catch(() => {}), RETAIN_MS + 1000).unref();
}

const active = new Map<string, () => void>();

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
  await stopRun(id);
  await removeRun(id);
}
