import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sessionBus, call } from "../native/bus.ts";
import { dataDir } from "./paths.ts";
import { quitDesktop } from "./window.ts";

const host = globalThis as typeof globalThis & { projectorRestart?: Promise<void> };

async function desktopPid(): Promise<number | undefined> {
  if (!process.env.DBUS_SESSION_BUS_ADDRESS) return;
  const bus = sessionBus();
  try {
    const reply = await call(
      bus,
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus",
      "GetConnectionUnixProcessID",
      "s",
      ["dev.projector.Launcher"],
    );
    return reply?.body[0] as number | undefined;
  } catch {
    return;
  } finally {
    bus.disconnect();
  }
}

async function prepareRestart(url: string): Promise<void> {
  const nativePid = await desktopPid();
  mkdirSync(dataDir(), { recursive: true });
  const log = openSync(join(dataDir(), "server.log"), "a");
  const child = (() => {
    try {
      return spawn(
        process.execPath,
        [
          fileURLToPath(new URL("../scripts/restart.mjs", import.meta.url)),
          String(process.pid),
          String(nativePid ?? ""),
        ],
        { detached: true, stdio: ["ignore", log, log, "ipc"] },
      );
    } finally {
      closeSync(log);
    }
  })();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Не удалось подготовить перезапуск Projector"));
    }, 5000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Перезапуск не подготовлен (${code})`));
    });
    child.once("message", (message) => {
      clearTimeout(timer);
      if (message !== "READY") {
        child.kill();
        reject(new Error("Некорректный ответ процесса перезапуска"));
        return;
      }
      child.unref();
      resolve();
    });
  });
  await quitDesktop(url);
}

/** Survives config reloads and coalesces concurrent clicks into one successor. */
export function restartProjector(url: string): Promise<void> {
  return (host.projectorRestart ??= prepareRestart(url).catch((error) => {
    host.projectorRestart = undefined;
    throw error;
  }));
}
