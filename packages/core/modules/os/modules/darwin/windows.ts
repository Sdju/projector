import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { ensureHelperSync } from "./shell.ts";

const BROWSERS = ["Google Chrome", "Chromium", "Brave Browser", "Microsoft Edge", "Arc"].map(
  (name) => ({ name, path: `/Applications/${name}.app` }),
);

function findBrowser(): string | null {
  return BROWSERS.find((browser) => existsSync(browser.path))?.name ?? null;
}

function run(bin: string, args: string[]): void {
  const child = spawn(bin, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

function openApp(browser: string, args: string[]): void {
  run("open", ["-na", browser, "--args", ...args]);
}

function http(url: string): string {
  if (!/^https?:\/\//i.test(url)) throw new Error("Допустимы только http(s) адреса");
  return url;
}

/**
 * Chromium on macOS has no window class, but it ignores unknown switches and ps lists them:
 * `--class=<name>` marks the app process so it can be found again.
 */
function appPid(appClass: string): number | null {
  try {
    const rows = execFileSync("ps", ["-axo", "pid=,args="], { encoding: "utf8" }).split("\n");
    for (const row of rows) {
      const match = /^\s*(\d+)\s+(.*)$/.exec(row);
      if (match && match[2]!.includes(`--class=${appClass}`) && !match[2]!.includes("--type="))
        return Number(match[1]);
    }
  } catch {
    /* ps is unavailable: nothing can be found. */
  }
  return null;
}

/** Asks the helper to act on the app; returns its state, or null when the app is gone. */
function control(pid: number, command: "activate" | "hide" | "terminate" | "status") {
  try {
    return execFileSync(ensureHelperSync(), ["--app", String(pid), command], {
      encoding: "utf8",
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}

export function focusAppWindow(appClass: string): boolean {
  const pid = appPid(appClass);
  return pid !== null && control(pid, "activate") !== null;
}
export function openWindow(url: string): void {
  const browser = findBrowser();
  if (browser) openApp(browser, [`--app=${http(url)}`]);
  else run("open", [http(url)]);
}
export function openBrowser(url: string): void {
  run("open", [http(url)]);
}
export function openOrFocusApp(url: string, appClass: string, profile: string): void {
  if (focusAppWindow(appClass)) return;
  const browser = findBrowser();
  if (!browser) return run("open", [http(url)]);
  mkdirSync(profile, { recursive: true });
  openApp(browser, [
    `--app=${http(url)}`,
    `--user-data-dir=${profile}`,
    `--class=${appClass}`,
    "--no-first-run",
    "--no-default-browser-check",
  ]);
}
export function hidePalette(appClass: string): void {
  const pid = appPid(appClass);
  if (pid !== null) control(pid, "hide");
}
export function closePalette(appClass: string): void {
  const pid = appPid(appClass);
  if (pid !== null) control(pid, "terminate");
}
export function openWebPalette(
  url: string,
  toggle: boolean,
  appClass: string,
  profile: string,
): void {
  const pid = appPid(appClass);
  if (pid !== null) {
    if (toggle && control(pid, "status") === "active") control(pid, "hide");
    else control(pid, "activate");
    return;
  }
  const browser = findBrowser();
  if (!browser) throw new Error("Не найден Chromium-совместимый браузер; выберите режим браузера");
  mkdirSync(profile, { recursive: true });
  openApp(browser, [
    `--app=${http(url)}?surface=window`,
    `--user-data-dir=${profile}`,
    `--class=${appClass}`,
    "--window-size=660,500",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
  ]);
}
export function activateWindow(_id: number | bigint): void {}
export async function activateSurface(_surface: object): Promise<void> {}

/** Raises this very process (the GTK palette is a plain binary, not an app bundle). */
export function focusSelf(): void {
  control(process.pid, "activate");
}

/** Whether this process has a window on screen (the GTK palette is visible). */
export function ownWindowVisible(): boolean {
  try {
    const out = execFileSync(ensureHelperSync(), ["--windows", String(process.pid)], {
      encoding: "utf8",
      timeout: 10_000,
    });
    return Number(/windows:(\d+)/.exec(out)?.[1] ?? 0) > 0;
  } catch {
    return false;
  }
}
