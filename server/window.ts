import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { APP_CLASS, chromeProfileDir } from "./paths.ts";
import { preferences, type InterfaceMode } from "./launcher.ts";
import { desktopArgs } from "./desktop.ts";

const BROWSERS = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
  "brave-browser",
  "microsoft-edge-stable",
  "microsoft-edge",
];

function which(bin: string): boolean {
  try {
    execFileSync("which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function findBrowser(): string | null {
  for (const bin of BROWSERS) {
    if (which(bin)) return bin;
  }
  return null;
}

function tryExec(bin: string, args: string[]): boolean {
  if (!which(bin)) return false;
  try {
    execFileSync(bin, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function focusAppWindow(): boolean {
  return (
    tryExec("wmctrl", ["-xa", APP_CLASS]) ||
    tryExec("xdotool", ["search", "--onlyvisible", "--class", APP_CLASS, "windowactivate"])
  );
}

function spawnDetached(bin: string, args: string[]): void {
  const child = spawn(bin, args, { detached: true, stdio: "ignore" });
  child.unref();
}

export function openWindow(url: string): void {
  const browser = findBrowser();
  if (browser) {
    spawnDetached(browser, [`--app=${url}`]);
    return;
  }
  spawnDetached("xdg-open", [url]);
}

export function openBrowser(url: string): void {
  spawnDetached("xdg-open", [url]);
}

export function openOrFocusApp(url: string): void {
  if (focusAppWindow()) return;

  const profile = chromeProfileDir();
  mkdirSync(profile, { recursive: true });

  const browser = findBrowser();
  if (browser) {
    spawnDetached(browser, [
      `--app=${url}`,
      `--user-data-dir=${profile}`,
      `--class=${APP_CLASS}`,
      `--name=${APP_CLASS}`,
      "--no-first-run",
      "--no-default-browser-check",
    ]);
    return;
  }

  spawnDetached("xdg-open", [url]);
}

const PALETTE_CLASS = "ProjectorLauncher";

function paletteWindow(): string | null {
  try {
    const ids = execFileSync("xdotool", ["search", "--class", `^${PALETTE_CLASS}$`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n");
    // Chromium also tags invisible helper windows with the app class.
    // WM_STATE identifies the actual managed window, including when hidden.
    for (const id of ids) {
      const state = execFileSync("xprop", ["-id", id, "WM_STATE"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      if (state.startsWith("WM_STATE(WM_STATE)")) return id;
    }
    return null;
  } catch { return null; }
}

export function hidePalette(): void {
  const id = paletteWindow();
  if (id) tryExec("xdotool", ["windowunmap", id]);
}

function openWebPalette(url: string, toggle: boolean): void {
  const id = paletteWindow();
  if (id) {
    const active = tryGetActiveWindow();
    if (toggle && active === id) hidePalette();
    else {
      tryExec("xdotool", ["windowmap", id]);
      tryExec("xdotool", ["windowactivate", "--sync", id]);
    }
    return;
  }
  const browser = findBrowser();
  if (!browser) throw new Error("Не найден Chromium-совместимый браузер; выберите режим браузера");
  const profile = `${chromeProfileDir()}-launcher`;
  mkdirSync(profile, { recursive: true });
  spawnDetached(browser, [
    `--app=${url}?surface=window`, `--user-data-dir=${profile}`, `--class=${PALETTE_CLASS}`,
    `--name=${PALETTE_CLASS}`, "--window-size=660,500", "--no-first-run", "--no-default-browser-check",
    "--disable-features=Translate",
  ]);
}

function tryGetActiveWindow(): string | null {
  try { return execFileSync("xdotool", ["getactivewindow"], { encoding: "utf8" }).trim(); }
  catch { return null; }
}

function desktopCommand(url: string, action: "show" | "toggle" | "tray" | "quit"): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...desktopArgs(), "native", url, action],
      { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Системное окно не ответило. Проверьте GTK4 и desktop-сессию."));
    }, 8000);
    child.stderr.on("data", (chunk) => { errors = (errors + chunk.toString()).slice(-8000); });
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (!output.includes("READY")) return;
      clearTimeout(timeout);
      child.unref();
      resolve();
    });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (!output.includes("READY")) reject(new Error(errors.trim() || `Системное окно завершилось (${code})`));
    });
  });
}

export function startTray(url: string): Promise<void> {
  return desktopCommand(url, "tray");
}

export async function quitDesktop(url: string): Promise<void> {
  const id = paletteWindow();
  if (id) tryExec("xdotool", ["windowclose", id]);
  await desktopCommand(url, "quit").catch(() => undefined);
}

export async function openLauncher(url: string, mode?: InterfaceMode, toggle = false): Promise<InterfaceMode> {
  const selected = mode ?? (await preferences()).mode;
  if (selected === "native") await desktopCommand(url, toggle ? "toggle" : "show");
  else {
    await startTray(url).catch((error) => console.warn("Трей недоступен:", error.message));
    if (selected === "window") openWebPalette(url, toggle);
    else openBrowser(url);
  }
  return selected;
}
