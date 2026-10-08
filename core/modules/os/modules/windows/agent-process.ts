import { spawn } from "node:child_process";
import { basename } from "node:path";
import { bindTreeToJob, warmJob } from "./job.ts";
import { killTree } from "./kill-tree.ts";
import type { AgentHostSpec, AgentLaunch, AgentProcess, AgentProcessSpec } from "../../contract.ts";

/** `shell: true` joins argv with spaces, so anything with whitespace or quotes is quoted for cmd.exe. */
function quoteForCmd(value: string): string {
  if (value !== "" && !/[\s"&|<>^()%]/.test(value)) return value;
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

/**
 * A separate stdio process per chat turn: Projector never touches the user's own sessions.
 * `.cmd` shims (npx, npm-global binaries) are not executable without a shell on Windows, and
 * `taskkill /T` stops the tree the shell started.
 */
/** `.cmd` shims are not executable without a shell on Windows, and a shell joins argv unquoted. */
export function agentLaunch(spec: Pick<AgentProcessSpec, "command" | "args">): AgentLaunch {
  return { command: quoteForCmd(spec.command), args: spec.args.map(quoteForCmd), shell: true };
}

export function spawnAgentProcess(spec: AgentProcessSpec): AgentProcess {
  const launch = agentLaunch(spec);
  const child = spawn(launch.command, launch.args, {
    cwd: spec.cwd,
    env: spec.env as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: launch.shell,
  }) as AgentProcess;
  // Bound to the server's lifetime: a crashed server no longer leaves the agent tree behind.
  if (child.pid) void bindTreeToJob(child.pid);
  child.terminate = () => terminateTree(child);
  return child;
}

async function terminateTree(child: AgentProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  if (child.pid) await killTree(child.pid);
  else child.kill();
  await closed;
}

/** Windows services inherit the user's PATH, so the environment is used as is. */
export async function agentEnv(
  base: Record<string, string | undefined>,
): Promise<Record<string, string | undefined>> {
  void warmJob();
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
  void killTree(pid);
}
