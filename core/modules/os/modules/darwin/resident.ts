import type { DesktopAction, DesktopPalette, ResidentOptions } from "../../contract.ts";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataHome } from "./directories.ts";
import { processIdentity } from "./processes.ts";
import { startDesktopShell } from "./shell.ts";
import { openBrowser, openWebPalette } from "./windows.ts";

const actions: DesktopAction[] = ["show", "toggle", "tray", "quit"];
const appDirectory = "projector";
const PALETTE_CLASS = "ProjectorLauncher";

const isAction = (value: string): value is DesktopAction =>
  actions.includes(value as DesktopAction);
const pidPath = (directory: string) => join(directory, "launcher.pid");
const tokenPath = (directory: string) => join(directory, "launcher.token");

/** A unix socket path is limited to about 100 bytes, so a deep data directory falls back to /tmp. */
function socketPath(directory: string): string {
  const path = join(directory, "launcher.sock");
  return path.length < 100 ? path : join(tmpdir(), `projector-launcher-${process.getuid?.()}.sock`);
}

export async function desktopPid(name: string): Promise<number | undefined> {
  if (name !== "dev.projector.Launcher") return;
  try {
    const pid = Number((await readFile(pidPath(join(dataHome(), appDirectory)), "utf8")).trim());
    return processIdentity(pid) ? pid : undefined;
  } catch {
    return;
  }
}

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
    socket.setTimeout(3000, () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("connect", () => socket.write(`${token} ${action}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes("READY")) finish(true);
    });
    socket.on("end", () => finish(buffer.includes("READY")));
  });
}

function sameToken(given: string, token: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The palette is the Chromium app window; macOS has no GTK palette. */
function webPalette(baseUrl: string, directory: string): DesktopPalette {
  const profile = `${join(directory, "chrome-profile")}-launcher`;
  const post = async (path: string) => {
    const response = await fetch(baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}",
    });
    if (!response.ok) throw new Error(`Не удалось выполнить ${path}`);
  };
  const open = async (toggle: boolean) => openWebPalette(baseUrl, toggle, PALETTE_CLASS, profile);
  return {
    show: () => open(false),
    toggle: () => open(true),
    invokeSelected: (toggle = false) => open(toggle),
    openPage: (path) => openBrowser(baseUrl + path),
    quitProjector: () => post("/api/app/quit"),
    restartProjector: () => post("/api/app/restart"),
    dispose: () => {},
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
  if (await forward(action, directory)) {
    console.log("READY");
    return;
  }
  if (action === "quit") {
    console.log("READY");
    return;
  }
  await mkdir(directory, { recursive: true });
  const token = randomBytes(24).toString("hex");
  const palette = webPalette(baseUrl, directory);
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
        .catch(() => socket.destroy());
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
    await shell?.stop();
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
  console.log("READY");
  await untilStop;
}
