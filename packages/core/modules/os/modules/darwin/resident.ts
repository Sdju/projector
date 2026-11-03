import type { DesktopAction, DesktopPalette, ResidentOptions } from "../../contract.ts";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gtkAvailable } from "./gtk.ts";
import { processIdentity } from "./processes.ts";
import { startDesktopShell } from "./shell.ts";
import { focusSelf, ownWindowVisible } from "./windows.ts";

const actions: DesktopAction[] = ["show", "toggle", "tray", "quit"];

const isAction = (value: string): value is DesktopAction =>
  actions.includes(value as DesktopAction);
const pidPath = (directory: string) => join(directory, "launcher.pid");
const tokenPath = (directory: string) => join(directory, "launcher.token");

/** A unix socket path is limited to about 100 bytes, so a deep data directory falls back to /tmp. */
function socketPath(directory: string): string {
  const path = join(directory, "launcher.sock");
  return path.length < 100 ? path : join(tmpdir(), `projector-launcher-${process.getuid?.()}.sock`);
}

let lastFailure = "";
async function forward(action: DesktopAction, directory: string): Promise<boolean> {
  const token = (await readFile(tokenPath(directory), "utf8").catch(() => "")).trim();
  if (!token) return false;
  return new Promise((resolve) => {
    const socket = net.connect(socketPath(directory));
    let buffer = "";
    const finish = (accepted: boolean) => {
      socket.destroy();
      resolve(accepted);
    };
    // Once the command is sent it is never re-sent: a retry would run it a second time.
    let sent = false;
    socket.setTimeout(30_000, () => {
      lastFailure = "тайм-аут ответа";
      finish(sent);
    });
    socket.on("error", (error) => {
      lastFailure = error.message;
      finish(false);
    });
    socket.on("connect", () => {
      sent = true;
      socket.write(`${token} ${action}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes("READY")) finish(true);
      else if (buffer.includes("ERROR ")) {
        console.error(buffer.trim());
        finish(true);
      }
    });
    socket.on("end", () => {
      if (!buffer.includes("READY")) lastFailure = `соединение закрыто: ${buffer.trim()}`;
      finish(buffer.includes("READY"));
    });
  });
}

function sameToken(given: string, token: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Node owns the thread, so GTK is pumped from a timer: fast while events flow, slow while idle.
 * Every show also asks the helper to raise the process: a bare binary is not frontmost by itself.
 */
async function gtkPalette(
  baseUrl: string,
  options: ResidentOptions,
  setTimer: (timer: ReturnType<typeof setTimeout>) => void,
): Promise<DesktopPalette> {
  if (!gtkAvailable()) throw new Error("GTK4 не установлен (brew install gtk4)");
  const { default: Gtk } = await import("gi:Gtk-4.0");
  const { default: GLib } = await import("gi:GLib-2.0");
  Gtk.init();
  const context = GLib.MainLoop.new(null, false).getContext();
  let lastActive = Date.now();
  let stopped = false;
  const pump = () => {
    if (stopped) return;
    try {
      for (let step = 0; step < 64 && context.iteration(false); step++) lastActive = Date.now();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
    setTimer(setTimeout(pump, Date.now() - lastActive < 2000 ? 10 : 50));
  };
  pump();
  const inner = await options.createPalette(baseUrl);
  /** Raising after a hide would bring the app, and with it the window, back to the front. */
  const raise = async (action: () => Promise<void>, toggles: boolean) => {
    const wasVisible = toggles && ownWindowVisible();
    await action();
    if (!wasVisible) focusSelf();
  };
  return {
    show: () => raise(() => inner.show(), false),
    toggle: () => {
      const wasVisible = ownWindowVisible();
      return inner.toggle().then(async () => {
        if (!wasVisible) focusSelf();
      });
    },
    invokeSelected: (toggle) => raise(() => inner.invokeSelected(toggle), toggle === true),
    openPage: (path) => inner.openPage(path),
    quitProjector: () => inner.quitProjector(),
    restartProjector: () => inner.restartProjector(),
    dispose: () => {
      stopped = true;
      inner.dispose();
    },
  };
}

/** Owns the menu-bar item and hotkey. A second launch only forwards show, toggle, tray or quit. */
export async function runResident(
  baseUrl: string,
  action: DesktopAction,
  options: ResidentOptions,
) {
  if (!isAction(action)) throw new Error("Неизвестная команда");
  const directory = options.dataDirectory;
  // A busy resident can answer slowly. While its process lives, never start a second one.
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await forward(action, directory)) {
      console.log("READY");
      return;
    }
    const pid = Number((await readFile(pidPath(directory), "utf8").catch(() => "")).trim());
    if (!pid || !processIdentity(pid)) break;
    if (attempt === 4) throw new Error(`Резидент не отвечает (${lastFailure})`);
  }
  if (action === "quit") {
    console.log("READY");
    return;
  }
  await mkdir(directory, { recursive: true });
  const token = randomBytes(24).toString("hex");
  let pulse: ReturnType<typeof setTimeout> | undefined;
  const palette = await gtkPalette(baseUrl, options, (timer) => (pulse = timer));
  let stopping = false;
  let release = () => {};
  const untilStop = new Promise<void>((resolve) => (release = resolve));
  let configure: (shortcut: string) => Promise<void> = async () => {};
  const configured = async () => {
    try {
      const shortcut = JSON.parse(
        await readFile(join(directory, "launcher.json"), "utf8"),
      ).shortcut;
      return typeof shortcut === "string" ? shortcut : "Ctrl+Alt+Space";
    } catch {
      return "Ctrl+Alt+Space";
    }
  };
  const report = (error: unknown) =>
    console.error("Хоткей:", error instanceof Error ? error.message : error);
  const dispatch = async (requested: DesktopAction) => {
    if (requested === "quit") setTimeout(() => void stop(), 50);
    else if (requested === "tray") await configure(await configured()).catch(report);
    else if (requested === "toggle") await palette.toggle();
    else await palette.show();
  };
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const [given = "", requested = ""] = buffer.slice(0, newline).trim().split(" ");
      if (!sameToken(given, token) || !isAction(requested)) return void socket.destroy();
      void dispatch(requested)
        .then(() => socket.end("READY\n"))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error("Команда резиденту:", message);
          socket.end(`ERROR ${message.replace(/\s+/g, " ")}\n`);
        });
    });
  });
  const path = socketPath(directory);
  await rm(path, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  await chmod(path, 0o600).catch(() => undefined);
  await writeFile(pidPath(directory), `${process.pid}\n`);
  await writeFile(tokenPath(directory), `${token}\n`, { mode: 0o600 });

  async function stop() {
    if (stopping) return;
    stopping = true;
    clearTimeout(pulse);
    await shell?.stop();
    palette.dispose();
    server.close();
    await rm(path, { force: true });
    await rm(pidPath(directory), { force: true });
    await rm(tokenPath(directory), { force: true });
    release();
  }
  let shell: Awaited<ReturnType<typeof startDesktopShell>> | undefined;
  try {
    shell = await startDesktopShell(directory, {
      onActivate: () => void palette.invokeSelected(),
      onHotkey: () => void palette.invokeSelected(true),
      onSettings: () => palette.openPage("/settings"),
      onRestart: () => void palette.restartProjector().catch(report),
      onQuit: () => void palette.quitProjector().catch(() => void stop()),
    });
    const active = shell;
    configure = (shortcut) => active.configure(shortcut);
    await configure(await configured()).catch(report);
  } catch (error) {
    await stop();
    throw error;
  }
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
  await dispatch(action);
  console.log("PALETTE:gtk");
  console.log("READY");
  await untilStop;
}
