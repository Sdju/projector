import type { DesktopAction } from "../../contract.ts";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { userInfo } from "node:os";
import { readFile, rm } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import { dataHome } from "./directories.ts";
import { killTree } from "./kill-tree.ts";
import { processIdentity } from "./processes.ts";

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const service = "dev.projector.Launcher";
const actions: DesktopAction[] = ["show", "toggle", "tray", "quit"];
/** Same directory as `dataDir()` without importing app-paths back into the OS adapter. */
const appDirectory = "projector";

export function isDesktopAction(value: string): value is DesktopAction {
  return actions.includes(value as DesktopAction);
}

/** One pipe per Windows user: a fixed name would let a second account's session collide with it. */
function pipeName(): string {
  const user = userInfo().username.replace(/[^\w.-]/g, "_");
  return process.env.PROJECTOR_LAUNCHER_PIPE || `\\\\.\\pipe\\${service}.${user}`;
}

/** The pipe has the default DACL, so every command must prove it can read the user's profile. */
function sameToken(given: string, token: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function launcherPidPath(dataDirectory = join(dataHome(), appDirectory)): string {
  return join(dataDirectory, "launcher.pid");
}

export function launcherTokenPath(dataDirectory = join(dataHome(), appDirectory)): string {
  return join(dataDirectory, "launcher.token");
}

export function launcherIdentityPath(dataDirectory: string): string {
  return join(dataDirectory, "launcher.identity.json");
}

/** Named pipes carry no per-user ACL here, so commands must quote the secret kept in the profile. */
async function readToken(dataDirectory: string): Promise<string> {
  try {
    return (await readFile(launcherTokenPath(dataDirectory), "utf8")).trim();
  } catch {
    return "";
  }
}

export async function forward(
  action: DesktopAction,
  dataDirectory: string,
  requestId = randomUUID(),
): Promise<boolean> {
  const token = await readToken(dataDirectory);
  if (!token) return false;
  return new Promise((resolve) => {
    const socket = net.connect(pipeName());
    let buffer = "";
    let settled = false;
    const finish = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(accepted);
    };
    socket.setTimeout(1500, () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("close", () => finish(false));
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      if (buffer.includes("READY")) finish(true);
    });
    socket.on("connect", () => {
      socket.write(`${token} ${action} ${requestId}\n`);
    });
  });
}

async function readPidFile(dataDirectory: string): Promise<number | undefined> {
  try {
    const pid = Number((await readFile(launcherPidPath(dataDirectory), "utf8")).trim());
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return;
  }
}

/**
 * A busy resident can answer slowly (GTK + tray C# compile). While its pid file
 * exists, keep forwarding instead of starting a second instance that loses on
 * EADDRINUSE. Avoid calling processIdentity on every attempt — it shells out to
 * PowerShell and can burn the whole READY budget under load.
 */
export async function waitForForward(
  action: DesktopAction,
  dataDirectory: string,
  attempts = 8,
  requestId = randomUUID(),
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await forward(action, dataDirectory, requestId)) return true;
    const pid = await readPidFile(dataDirectory);
    if (!pid) return false;
    if (attempt + 1 >= attempts) return false;
    if (attempt === attempts - 2) {
      const alive = await processIdentity(pid).catch(() => null);
      if (!alive) {
        await rm(launcherPidPath(dataDirectory), { force: true });
        return false;
      }
    }
    await sleep(100 + attempt * 100);
  }
  return false;
}

/** Drop a hung or abandoned pipe owner so this process can bind. */
export async function reclaim(dataDirectory: string): Promise<void> {
  const pid = await readPidFile(dataDirectory);
  // A stale PID may have been reused. Legacy pid-only records are never enough
  // authority to terminate a process; require the recorded Windows creation time.
  if (pid) {
    const identity = await readFile(launcherIdentityPath(dataDirectory), "utf8")
      .then((value) => JSON.parse(value) as { pid?: number; started?: string })
      .catch(() => null);
    if (
      identity?.pid === pid &&
      typeof identity.started === "string" &&
      identity.started &&
      (await processIdentity(pid)) === identity.started
    )
      await killTree(pid);
  }
  await rm(launcherPidPath(dataDirectory), { force: true });
  await rm(launcherTokenPath(dataDirectory), { force: true });
  await rm(launcherIdentityPath(dataDirectory), { force: true });
  // Named-pipe teardown is not instantaneous after taskkill.
  for (let attempt = 0; attempt < 20; attempt++) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = net.createServer();
      probe.once("error", () => {
        probe.close();
        resolve(false);
      });
      probe.listen(pipeName(), () => {
        probe.close(() => resolve(true));
      });
    });
    if (free) return;
    await sleep(50);
  }
}

export function pipeTaken(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EADDRINUSE" || code === "EACCES";
}

export function bindPipe(
  token: string,
  dispatch: (action: DesktopAction) => Promise<void>,
): Promise<net.Server> {
  // Keep pending requests through disconnects and remember recent completions so
  // retrying after a lost READY cannot execute a toggle twice.
  const requests = new Map<string, { action: DesktopAction; done: Promise<void> }>();
  const completed: string[] = [];
  const server = net.createServer((socket) => {
    socket.on("error", () => socket.destroy());
    let buffer = "";
    let handled = false;
    socket.on("data", (chunk: Buffer) => {
      if (handled) return;
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      const [given, requested = "", requestId] = buffer.slice(0, newline).trim().split(" ");
      if (!sameToken(given ?? "", token) || !isDesktopAction(requested)) {
        socket.destroy();
        return;
      }
      const previous = requestId ? requests.get(requestId) : undefined;
      if (previous && previous.action !== requested) {
        socket.destroy();
        return;
      }
      const done = previous?.done ?? Promise.resolve().then(() => dispatch(requested));
      if (requestId && !previous) {
        requests.set(requestId, { action: requested, done });
        const remember = () => {
          completed.push(requestId);
          if (completed.length > 128) requests.delete(completed.shift()!);
        };
        void done.then(remember, remember);
      }
      void done
        .then(() => socket.end("READY\n"))
        .catch((error: unknown) => {
          console.error(error instanceof Error ? error.message : error);
          socket.destroy();
        });
    });
  });
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      server.close();
      reject(error);
    };
    server.once("error", fail);
    server.listen(pipeName(), () => {
      server.off("error", fail);
      resolve(server);
    });
  });
}
