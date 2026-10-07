import { execFile, spawn } from "node:child_process";
import { shell } from "./directories.ts";
import type { AgentProcess, AgentProcessSpec } from "../../contract.ts";

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
