import { execFile, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { shell } from "./directories.ts";
import type { AgentHostSpec, AgentProcess, AgentProcessSpec } from "../../contract.ts";

/** How long a tree gets to exit on SIGTERM before SIGKILL. */
const TERM_GRACE_MS = 3000;

/**
 * A separate process group per turn (`detached`), so the whole tree — the agent plus everything
 * its shell started — can be stopped with one signal to the group. The trade-off is that a
 * Projector crash mid-turn leaves the group orphaned; turns are short-lived, so no accounting yet.
 */
export function spawnAgentProcess(spec: AgentProcessSpec): AgentProcess {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  }) as AgentProcess;
  child.terminate = () => terminateTree(child);
  return child;
}

function signalTree(child: AgentProcess, signal: NodeJS.Signals) {
  try {
    if (child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    /* The group is already gone. */
  }
}

async function terminateTree(child: AgentProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  signalTree(child, "SIGTERM");
  const timer = setTimeout(() => signalTree(child, "SIGKILL"), TERM_GRACE_MS);
  timer.unref();
  await closed;
  clearTimeout(timer);
}

const PATH_MARK = "__PROJECTOR_PATH__";
let userPath: Promise<string | undefined> | undefined;

/**
 * The PATH an interactive terminal would have. The server often starts from a desktop launcher
 * or a service manager whose PATH lacks what `.bashrc`/`.zshrc` add (`~/.local/bin`, `~/.opencode/bin`),
 * while terminal sessions run `$SHELL -i -c exec <program>`. The result is cached for the process.
 */
function interactiveShellPath(): Promise<string | undefined> {
  userPath ??= new Promise((resolve) => {
    execFile(
      shell(),
      ["-i", "-c", `printf '${PATH_MARK}%s${PATH_MARK}' "$PATH"`],
      { timeout: 5000, env: process.env },
      (error, stdout) => {
        const match = new RegExp(`${PATH_MARK}(.*)${PATH_MARK}`, "s").exec(String(stdout));
        resolve(error && !match ? undefined : match?.[1] || undefined);
      },
    );
  });
  return userPath;
}

/** `base` with the user's interactive-shell PATH entries added after the server's own. */
export async function agentEnv(
  base: Record<string, string | undefined>,
): Promise<Record<string, string | undefined>> {
  const extra = await interactiveShellPath();
  if (!extra) return base;
  const seen = new Set<string>();
  const merged = [...(base.PATH ?? "").split(":"), ...extra.split(":")].filter(
    (entry) => entry && !seen.has(entry) && !!seen.add(entry),
  );
  return { ...base, PATH: merged.join(":") };
}

/** A unix socket path is limited to about 108 bytes, so a deep data directory falls back to /tmp. */
export function agentHostAddress(dir: string): string {
  const path = join(dir, "host.sock");
  return path.length < 100 ? path : join(tmpdir(), `projector-agent-${basename(dir)}.sock`);
}

/**
 * Starts the script that holds an agent process outside the server's own life: its own session,
 * no inherited stdio, so a server restart or crash leaves it (and the answer in progress) running.
 */
export function spawnAgentHost(spec: AgentHostSpec): number | undefined {
  const child = spawn(process.execPath, [spec.script, spec.dir, spec.address], {
    env: spec.env as NodeJS.ProcessEnv,
    stdio: ["ignore", spec.log, spec.log],
    detached: true,
  });
  child.on("error", () => {});
  child.unref();
  return child.pid;
}

/** Stops a hosted agent and everything it started: SIGTERM to the group, SIGKILL after a grace period. */
export function killAgentTree(pid: number): void {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* The group is already gone. */
    }
  }, TERM_GRACE_MS).unref();
}
