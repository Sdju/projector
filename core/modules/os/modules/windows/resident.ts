import type { DesktopAction, ResidentOptions } from "../../contract.ts";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, join } from "node:path";
import { dataHome } from "./directories.ts";
import { processIdentity } from "./processes.ts";
import { startDesktopShell } from "./shell.ts";

const service = "dev.projector.Launcher";
const actions: DesktopAction[] = ["show", "toggle", "tray", "quit"];
/** Same directory as `dataDir()` without importing app-paths back into the OS adapter. */
const appDirectory = "projector";

function pipeName(): string {
  return process.env.PROJECTOR_LAUNCHER_PIPE || `\\\\.\\pipe\\${service}`;
}

export function launcherPidPath(dataDirectory = join(dataHome(), appDirectory)): string {
  return join(dataDirectory, "launcher.pid");
}

export async function desktopPid(name: string): Promise<number | undefined> {
  if (name !== service) return;
  try {
    const pid = Number((await readFile(launcherPidPath(), "utf8")).trim());
    if (!processIdentity(pid)) {
      await rm(launcherPidPath(), { force: true });
      return;
    }
    return pid;
  } catch {
    return;
  }
}

export function launcherTokenPath(dataDirectory = join(dataHome(), appDirectory)): string {
  return join(dataDirectory, "launcher.token");
}

/** Named pipes carry no per-user ACL here, so commands must quote the secret kept in the profile. */
async function readToken(dataDirectory: string): Promise<string> {
  try {
    return (await readFile(launcherTokenPath(dataDirectory), "utf8")).trim();
  } catch {
    return "";
  }
}

function isAction(value: string): value is DesktopAction {
  return actions.includes(value as DesktopAction);
}

async function forward(action: DesktopAction, dataDirectory: string): Promise<boolean> {
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
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      if (buffer.includes("READY")) finish(true);
    });
    socket.on("connect", () => {
      socket.write(`${token} ${action}\n`);
    });
  });
}

function taken(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EADDRINUSE" || code === "EACCES";
}

function bind(
  token: string,
  dispatch: (action: DesktopAction) => Promise<void>,
): Promise<net.Server> {
  const server = net.createServer((socket) => {
    let buffer = "";
    let handled = false;
    socket.on("data", (chunk: Buffer) => {
      if (handled) return;
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      const [given, requested = ""] = buffer.slice(0, newline).trim().split(" ");
      if (given !== token || !isAction(requested)) {
        socket.destroy();
        return;
      }
      void dispatch(requested)
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

/** Owns the palette process. A second launch only forwards show, toggle, tray or quit. */
export async function runResident(
  baseUrl: string,
  action: DesktopAction,
  options: ResidentOptions,
) {
  if (!isAction(action)) throw new Error("Неизвестная команда");
  if (await forward(action, options.dataDirectory)) {
    console.log("READY");
    return;
  }
  if (action === "quit") {
    console.log("READY");
    return;
  }

  const token = randomBytes(24).toString("hex");
  const queued: Array<() => Promise<void>> = [];
  let live: ((action: DesktopAction) => Promise<void>) | undefined;
  let server: net.Server;
  try {
    server = await bind(token, async (requested) => {
      if (live) {
        await live(requested);
        return;
      }
      await new Promise<void>((resolve, reject) => {
        queued.push(() => live!(requested).then(resolve, reject));
      });
    });
  } catch (error) {
    if (!taken(error) || !(await forward(action, options.dataDirectory))) throw error;
    console.log("READY");
    return;
  }

  const pidPath = launcherPidPath(options.dataDirectory);
  await mkdir(dirname(pidPath), { recursive: true });
  await writeFile(pidPath, `${process.pid}\n`);
  await writeFile(launcherTokenPath(options.dataDirectory), `${token}\n`, { mode: 0o600 });
  try {
    await own(baseUrl, action, options, server, pidPath, (next) => {
      live = next;
      return queued.splice(0);
    });
  } catch (error) {
    server.close();
    await rm(pidPath, { force: true });
    await rm(launcherTokenPath(options.dataDirectory), { force: true });
    throw error;
  }
}

async function own(
  baseUrl: string,
  action: DesktopAction,
  options: ResidentOptions,
  server: net.Server,
  pidPath: string,
  arm: (dispatch: (action: DesktopAction) => Promise<void>) => Array<() => Promise<void>>,
) {
  const { default: Gtk } = await import("gi:Gtk-4.0");
  const { default: GLib } = await import("gi:GLib-2.0");
  Gtk.init();
  const loop = GLib.MainLoop.new(null, false);
  // Node owns the thread. Blocking in MainLoop.run does not deliver named-pipe
  // events on Windows, so GTK is pumped from a libuv timer: fast while events
  // flow, slow while idle so a hidden palette costs almost nothing.
  const context = loop.getContext();
  let lastActive = Date.now();
  let pulse: ReturnType<typeof setTimeout> | undefined;
  const pump = () => {
    try {
      for (let step = 0; step < 64 && context.iteration(false); step++) lastActive = Date.now();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
    pulse = setTimeout(pump, Date.now() - lastActive < 2000 ? 10 : 50);
  };
  pump();
  try {
    const palette = await options.createPalette(baseUrl);
    let stopping = false;
    let release = () => {};
    const untilStop = new Promise<void>((resolve) => {
      release = resolve;
    });
    const shell = await startDesktopShell(options.dataDirectory, {
      onActivate: () => {
        void palette.invokeSelected();
      },
      onHotkey: () => {
        void palette.invokeSelected(true);
      },
      onSettings: () => palette.openPage("/settings"),
      onRestart: () => {
        void palette.restartProjector();
      },
      onQuit: () => {
        void palette.quitProjector();
      },
    });
    const configuredShortcut = async () => {
      try {
        const shortcut = JSON.parse(
          await readFile(join(options.dataDirectory, "launcher.json"), "utf8"),
        ).shortcut;
        return typeof shortcut === "string" ? shortcut : "Ctrl+Alt+Space";
      } catch {
        return "Ctrl+Alt+Space";
      }
    };
    await shell.configure(await configuredShortcut()).catch((error: unknown) => {
      console.error("Хоткей:", error instanceof Error ? error.message : error);
    });
    async function stop() {
      if (stopping) return;
      stopping = true;
      clearTimeout(pulse);
      await shell.stop();
      palette.dispose();
      server.close();
      await rm(pidPath, { force: true });
      await rm(launcherTokenPath(options.dataDirectory), { force: true });
      release();
    }
    const dispatch = async (requested: DesktopAction) => {
      if (requested === "quit") {
        setTimeout(() => {
          void stop();
        }, 50);
        return;
      }
      if (requested === "tray") {
        await shell.configure(await configuredShortcut()).catch((error: unknown) => {
          console.error("Хоткей:", error instanceof Error ? error.message : error);
        });
        return;
      }
      if (requested === "toggle") await palette.toggle();
      else await palette.show();
    };
    const missed = arm(dispatch);
    process.once("SIGTERM", () => {
      void stop();
    });
    process.once("SIGINT", () => {
      void stop();
    });
    await dispatch(action);
    for (const run of missed) await run();
    console.log("READY");
    await untilStop;
  } finally {
    clearTimeout(pulse);
  }
}
