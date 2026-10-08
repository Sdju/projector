import type { DesktopAction, ResidentOptions } from "../../contract.ts";
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

function isAction(value: string): value is DesktopAction {
  return actions.includes(value as DesktopAction);
}

function forward(action: DesktopAction): Promise<boolean> {
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
      socket.write(`${action}\n`);
    });
  });
}

function taken(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EADDRINUSE" || code === "EACCES";
}

function bind(dispatch: (action: DesktopAction) => Promise<void>): Promise<net.Server> {
  const server = net.createServer((socket) => {
    let buffer = "";
    let handled = false;
    socket.on("data", (chunk: Buffer) => {
      if (handled) return;
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      const requested = buffer.slice(0, newline).trim();
      if (!isAction(requested)) {
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
  if (await forward(action)) {
    console.log("READY");
    return;
  }
  if (action === "quit") {
    console.log("READY");
    return;
  }

  const queued: Array<() => Promise<void>> = [];
  let live: ((action: DesktopAction) => Promise<void>) | undefined;
  let server: net.Server;
  try {
    server = await bind(async (requested) => {
      if (live) {
        await live(requested);
        return;
      }
      await new Promise<void>((resolve, reject) => {
        queued.push(() => live!(requested).then(resolve, reject));
      });
    });
  } catch (error) {
    if (!taken(error) || !(await forward(action))) throw error;
    console.log("READY");
    return;
  }

  const pidPath = launcherPidPath(options.dataDirectory);
  await mkdir(dirname(pidPath), { recursive: true });
  await writeFile(pidPath, `${process.pid}\n`);
  try {
    await own(baseUrl, action, options, server, pidPath, (next) => {
      live = next;
      return queued.splice(0);
    });
  } catch (error) {
    server.close();
    await rm(pidPath, { force: true });
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
  // events on Windows, so GTK is pumped from the libuv timer instead.
  const context = loop.getContext();
  const pulse = setInterval(() => {
    try {
      context.iteration(false);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
  }, 10);
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
      clearInterval(pulse);
      await shell.stop();
      palette.dispose();
      server.close();
      await rm(pidPath, { force: true });
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
    clearInterval(pulse);
  }
}
