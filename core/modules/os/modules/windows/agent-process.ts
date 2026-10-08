import { spawn } from "node:child_process";
import { basename } from "node:path";
import { killTree } from "./kill-tree.ts";
import type { AgentHostSpec, AgentProcess, AgentProcessSpec } from "../../contract.ts";

/**
 * A separate stdio process per chat turn: Projector never touches the user's own sessions.
 * `.cmd` shims (npx, npm-global binaries) are not executable without a shell on Windows, and
 * `taskkill /T` stops the tree the shell started.
 */
export function spawnAgentProcess(spec: AgentProcessSpec): AgentProcess {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: true,
  }) as AgentProcess;
  child.terminate = () => terminateTree(child);
  return child;
}

async function terminateTree(child: AgentProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  if (child.pid) killTree(child.pid);
  else child.kill();
  await closed;
}

/** Windows services inherit the user's PATH, so the environment is used as is. */
export async function agentEnv(
  base: Record<string, string | undefined>,
): Promise<Record<string, string | undefined>> {
  return base;
}

export function agentHostAddress(dir: string): string {
  return `\\\\.\\pipe\\projector-agent-${basename(dir)}`;
}

/** Starts the script that holds an agent process outside the server's own life. */
export function spawnAgentHost(spec: AgentHostSpec): number | undefined {
  const child = spawn(process.execPath, [spec.script, spec.dir, spec.address], {
    env: spec.env as NodeJS.ProcessEnv,
    stdio: ["ignore", spec.log, spec.log],
    detached: true,
    windowsHide: true,
  });
  child.on("error", () => {});
  child.unref();
  return child.pid;
}

export function killAgentTree(pid: number): void {
  killTree(pid);
}
