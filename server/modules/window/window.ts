import { spawn } from "node:child_process";
import { os } from "../../../core/modules/os/index.ts";
import { APP_CLASS, chromeProfileDir } from "../../../core/modules/app-paths/index.ts";
import { preferences } from "../preferences/index.ts";
import type { InterfaceMode } from "../../../core/modules/launcher/index.ts";
import { nativeArgs } from "./desktop.ts";

const PALETTE_CLASS = "ProjectorLauncher";
export const focusAppWindow = () => os.windows.focusApp(APP_CLASS);
export const openWindow = (url: string) => os.windows.open(url);
export const openBrowser = (url: string) => os.windows.openBrowser(url);
export const openOrFocusApp = (url: string) =>
  os.windows.openOrFocusApp(url, APP_CLASS, chromeProfileDir());
export const hidePalette = () => os.windows.hidePalette(PALETTE_CLASS);

function desktopCommand(url: string, action: "show" | "toggle" | "tray" | "quit"): Promise<void> {
  os.requireSupported("native desktop");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...nativeArgs(), "native", url, action], {
      // Та же группа, что и сервер: Ctrl+C в `vp dev` доходит до резидента и снимает трей.
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Системное окно не ответило. Проверьте GTK4 и desktop-сессию."));
    }, 8000);
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      errors = (errors + text).slice(-8000);
      const line = text.trim();
      if (line) console.warn(line);
    });
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (!output.includes("READY")) return;
      clearTimeout(timeout);
      child.unref();
      resolve();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (!output.includes("READY"))
        reject(new Error(errors.trim() || `Системное окно завершилось (${code})`));
    });
  });
}

export function startTray(url: string): Promise<void> {
  return desktopCommand(url, "tray");
}

export async function quitDesktop(url: string): Promise<void> {
  await os.windows.closePalette(PALETTE_CLASS);
  await desktopCommand(url, "quit").catch(() => undefined);
}

export async function openLauncher(
  url: string,
  mode?: InterfaceMode,
  toggle = false,
): Promise<InterfaceMode> {
  const selected = mode ?? (await preferences()).mode;
  if (selected === "native") await desktopCommand(url, toggle ? "toggle" : "show");
  else {
    await startTray(url).catch((error) => console.warn("Трей недоступен:", error.message));
    if (selected === "window")
      await os.windows.openPalette(url, toggle, PALETTE_CLASS, `${chromeProfileDir()}-launcher`);
    else openBrowser(url);
  }
  return selected;
}
