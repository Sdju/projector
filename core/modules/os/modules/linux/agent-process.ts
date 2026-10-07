import { spawn } from "node:child_process";
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
