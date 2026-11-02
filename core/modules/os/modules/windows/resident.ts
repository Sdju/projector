import type { DesktopAction, DesktopPalette, ResidentOptions } from "../../contract.ts";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, join } from "node:path";
import { processIdentity } from "./processes.ts";
import { readWindowsColorScheme } from "./color-scheme.ts";
import { stopWindowHost, warmWindowHelper } from "./hwnd.ts";
import {
  bindPipe,
  forward,
  isDesktopAction,
  launcherPidPath,
  launcherIdentityPath,
  launcherTokenPath,
  pipeTaken,
  reclaim,
  waitForForward,
} from "./resident-pipe.ts";
import { startDesktopShell } from "./shell.ts";
import { restrictToOwner } from "./tools.ts";

const service = "dev.projector.Launcher";

export { launcherPidPath, launcherTokenPath } from "./resident-pipe.ts";

export async function desktopPid(name: string): Promise<number | undefined> {
  if (name !== service) return;
  try {
    const pid = Number((await readFile(launcherPidPath(), "utf8")).trim());
    // Windows processIdentity is async; a bare call always yields a truthy Promise.
    if (!(await processIdentity(pid))) {
      await rm(launcherPidPath(), { force: true });
      return;
    }
    return pid;
  } catch {
    return;
  }
}

/** Owns the palette process. A second launch only forwards show, toggle, tray or quit. */
export async function runResident(
  baseUrl: string,
  action: DesktopAction,
  options: ResidentOptions,
) {
  if (!isDesktopAction(action)) throw new Error("Неизвестная команда");
  const requestId = randomUUID();
  if (action === "quit") {
    if (
      (await forward(action, options.dataDirectory, requestId)) ||
      (await waitForForward(action, options.dataDirectory, 3, requestId))
    ) {
      console.log("READY");
      return;
    }
    await reclaim(options.dataDirectory).catch(() => undefined);
    console.log("READY");
    return;
  }
  // Same idea as macOS: never start a second resident while the first still answers.
  if (await waitForForward(action, options.dataDirectory, 8, requestId)) {
    console.log("READY");
    return;
  }

  // CIM can be slow. Resolve identity before binding so another launcher cannot
  // mistake a pipe waiting for its token to be published for a hung resident.
  const started = await processIdentity(process.pid);
  const token = randomBytes(24).toString("hex");
  const queued: Array<() => Promise<void>> = [];
  let live: ((action: DesktopAction) => Promise<void>) | undefined;
  const attach = async () =>
    bindPipe(token, async (requested) => {
      if (live) {
        await live(requested);
        return;
      }
      await new Promise<void>((resolve, reject) => {
        queued.push(() => live!(requested).then(resolve, reject));
      });
    });

  let server: net.Server;
  try {
    server = await attach();
  } catch (error) {
    if (!pipeTaken(error)) throw error;
    // Holder appeared between the forward loop and listen, or is hung with a stale token.
    if (await waitForForward(action, options.dataDirectory, 5, requestId)) {
      console.log("READY");
      return;
    }
    await reclaim(options.dataDirectory);
    try {
      server = await attach();
    } catch (retryError) {
      if (
        !pipeTaken(retryError) ||
        !(await waitForForward(action, options.dataDirectory, 5, requestId))
      )
        throw retryError;
      console.log("READY");
      return;
    }
  }

  const pidPath = launcherPidPath(options.dataDirectory);
  try {
    await mkdir(dirname(pidPath), { recursive: true });
    // Publish identity before GTK init so a racing second launch can forward instead of reclaiming.
    await writeFile(pidPath, `${process.pid}\n`);
    await writeFile(
      launcherIdentityPath(options.dataDirectory),
      JSON.stringify({ pid: process.pid, started }),
    );
    await writeFile(launcherTokenPath(options.dataDirectory), `${token}\n`, { mode: 0o600 });
    await restrictToOwner(launcherTokenPath(options.dataDirectory)).catch(() => undefined);
    await own(baseUrl, action, options, server, pidPath, (next) => {
      live = next;
      return queued.splice(0);
    });
  } catch (error) {
    server.close();
    await rm(pidPath, { force: true });
    await rm(launcherIdentityPath(options.dataDirectory), { force: true });
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
  // Loaded before any window exists: only then is its surface wrapped as a Win32Surface.
  await import("gi:GdkWin32-4.0").catch(() => undefined);
  Gtk.init();
  warmWindowHelper();
  const applyColorScheme = async () => {
    try {
      const resolved = await readWindowsColorScheme();
      if (!resolved) return;
      const settings = Gtk.Settings.getDefault();
      if (!settings) return;
      // GtkInterfaceColorScheme exists in newer GTK; older Windows bundles only follow the
      // system theme themselves, so there is nothing to set.
      const schemes = (
        Gtk as unknown as {
          InterfaceColorScheme?: { DARK: unknown; LIGHT: unknown };
        }
      ).InterfaceColorScheme;
      if (!schemes) return;
      const next = resolved === "dark" ? schemes.DARK : schemes.LIGHT;
      const target = settings as unknown as { gtkInterfaceColorScheme?: unknown };
      if (target.gtkInterfaceColorScheme !== next) target.gtkInterfaceColorScheme = next;
    } catch (error) {
      console.error("Тема:", error instanceof Error ? error.message : error);
    }
  };
  await applyColorScheme();
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
    // The tray host compiles C# while the palette loads. Sequential startup misses the
    // server's READY deadline when Vite is bundling at the same time.
    let palette: DesktopPalette | undefined;
    const deferred: Array<(palette: DesktopPalette) => void> = [];
    const withPalette = (run: (palette: DesktopPalette) => void) => {
      if (palette) run(palette);
      else deferred.push(run);
    };
    const shellPromise = startDesktopShell(options.dataDirectory, {
      onActivate: () => {
        withPalette((item) => void item.invokeSelected());
      },
      onHotkey: () => {
        withPalette((item) => void item.invokeSelected(true));
      },
      onSettings: () => {
        withPalette((item) => item.openPage("/settings"));
      },
      onRestart: () => {
        withPalette((item) => void item.restartProjector());
      },
      onQuit: () => {
        withPalette((item) => void item.quitProjector());
      },
      onColorScheme: () => {
        void applyColorScheme();
      },
    });
    let shell: Awaited<ReturnType<typeof startDesktopShell>>;
    try {
      palette = await options.createPalette(baseUrl);
    } catch (error) {
      shell = await shellPromise;
      await shell.stop();
      throw error;
    }
    for (const run of deferred.splice(0)) run(palette);
    shell = await shellPromise;
    let stopping = false;
    let release = () => {};
    const untilStop = new Promise<void>((resolve) => {
      release = resolve;
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
      try {
        await shell.stop();
      } catch (error) {
        console.error("Трей stop:", error instanceof Error ? error.message : error);
      }
      try {
        await stopWindowHost();
      } catch (error) {
        console.error("Окно stop:", error instanceof Error ? error.message : error);
      }
      try {
        palette?.dispose();
      } catch (error) {
        console.error("Палитра:", error instanceof Error ? error.message : error);
      }
      server.close();
      await rm(pidPath, { force: true });
      await rm(launcherIdentityPath(options.dataDirectory), { force: true });
      await rm(launcherTokenPath(options.dataDirectory), { force: true });
      release();
    }
    const dispatch = async (requested: DesktopAction) => {
      if (requested === "quit") {
        setTimeout(() => {
          void stop().catch((error: unknown) => {
            console.error("Остановка:", error instanceof Error ? error.message : error);
            release();
          });
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
