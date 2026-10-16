import { spawn } from "node:child_process";
import { os } from "../../../core/modules/os/index.ts";
import type { DockerDaemonState } from "../../../core/modules/docker/index.ts";
import { HttpError } from "../http/index.ts";
import { requireContext } from "./settings.ts";

const STOPPED =
  /cannot connect to (?:the )?docker daemon|daemon (?:is )?not running|is the docker daemon running|error during connect|dial unix|pipe\/docker|system cannot find the file|connection refused/i;
const WAIT_MS = 90_000;
const host = globalThis as typeof globalThis & { projectorDockerStart?: Promise<void> };

/** Tells a missing CLI from a daemon that is down; anything else stays a plain error. */
export function daemonState(error: unknown): DockerDaemonState | undefined {
  const text = error instanceof Error ? error.message : String(error);
  const missing = (error as NodeJS.ErrnoException)?.code === "ENOENT" || /not found/i.test(text);
  if (!missing && !STOPPED.test(text)) return undefined;
  const plan = os.tools.dockerStartPlan();
  return {
    state: missing ? "missing" : "stopped",
    start: { label: plan.label, auto: !!plan.command, manual: plan.manual },
  };
}

function reachable(context: string): Promise<boolean> {
  return (
    os.tools
      // `docker info` exits 0 even with no daemon; `ps` really needs one.
      .runDocker(["--context", context, "ps", "-q"], { timeout: 5000 })
      .then(
        () => true,
        () => false,
      )
  );
}

function launch(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });
    child.once("error", reject);
    // systemctl/pkexec report the outcome by exit code; GUI launchers return at once or never.
    const waits = /systemctl$|pkexec$|colima$/.test(command);
    child.once("exit", (code) =>
      !waits || code === 0 ? resolve() : reject(new Error(`${command} завершился с кодом ${code}`)),
    );
    if (!waits) {
      child.unref();
      resolve();
    }
  });
}

/** Brings the local Docker daemon up the way this OS does it, then waits until it answers. */
export async function startDockerDaemon(context: string): Promise<{ started: true }> {
  await requireContext(context);
  if (host.projectorDockerStart) throw new HttpError(409, "Docker уже запускается");
  const plan = os.tools.dockerStartPlan();
  if (!plan.command)
    throw new HttpError(409, plan.manual ?? "Запустить Docker автоматически не получится");
  if (await reachable(context)) return { started: true };
  const run = (async () => {
    try {
      await launch(plan.command!, plan.args ?? []);
    } catch (error) {
      throw new HttpError(
        500,
        `Не удалось выполнить «${plan.label}»: ${error instanceof Error ? error.message : error}`,
      );
    }
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      if (await reachable(context)) return;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new HttpError(504, "Docker запущен, но daemon не ответил за 90 секунд");
  })();
  host.projectorDockerStart = run;
  try {
    await run;
  } finally {
    host.projectorDockerStart = undefined;
  }
  return { started: true };
}
