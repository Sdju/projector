import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { closeWindow, findWindow, foregroundWindow, hideWindow, showWindow } from "./hwnd.ts";

const BROWSERS = [
  join(
    process.env.ProgramFiles || "C:\\Program Files",
    "Google",
    "Chrome",
    "Application",
    "chrome.exe",
  ),
  join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  join(
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    "Microsoft",
    "Edge",
    "Application",
    "msedge.exe",
  ),
  join(
    process.env.ProgramFiles || "C:\\Program Files",
    "Microsoft",
    "Edge",
    "Application",
    "msedge.exe",
  ),
  join(
    process.env.ProgramFiles || "C:\\Program Files",
    "BraveSoftware",
    "Brave-Browser",
    "Application",
    "brave.exe",
  ),
  join(
    process.env.LOCALAPPDATA || "",
    "BraveSoftware",
    "Brave-Browser",
    "Application",
    "brave.exe",
  ),
];

function findBrowser(): string | null {
  return BROWSERS.find((path) => path && existsSync(path)) ?? null;
}

function spawnDetached(bin: string, args: string[], env?: NodeJS.ProcessEnv): void {
  const child = spawn(bin, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: env ? { ...process.env, ...env } : process.env,
  });
  child.unref();
}

function openDefault(url: string): void {
  if (!/^https?:\/\//i.test(url)) throw new Error("Можно открыть только http(s)-адрес");
  // The address travels in the environment: it is never parsed as PowerShell source.
  spawnDetached(
    "powershell.exe",
    [
      "-NoProfile",
      "-WindowStyle",
      "Hidden",
      "-Command",
      "Start-Process -FilePath $env:PROJECTOR_URL",
    ],
    { PROJECTOR_URL: url },
  );
}

export function openBrowser(url: string): void {
  openDefault(url);
}

export function openWindow(url: string): void {
  const browser = findBrowser();
  if (browser) {
    spawnDetached(browser, [`--app=${url}`]);
    return;
  }
  openDefault(url);
}

export async function focusAppWindow(appClass: string): Promise<boolean> {
  const hwnd = await findWindow(appClass);
  if (!hwnd) return false;
  await showWindow(hwnd, appClass);
  return true;
}

export async function openOrFocusApp(
  url: string,
  appClass: string,
  profile: string,
): Promise<void> {
  if (await focusAppWindow(appClass)) return;
  mkdirSync(profile, { recursive: true });
  const browser = findBrowser();
  if (!browser) {
    openDefault(url);
    return;
  }
  spawnDetached(browser, [
    `--app=${url}`,
    `--user-data-dir=${profile}`,
    `--class=${appClass}`,
    "--no-first-run",
    "--no-default-browser-check",
  ]);
}

export async function hidePalette(appClass: string): Promise<void> {
  const hwnd = await findWindow(appClass);
  if (hwnd) await hideWindow(hwnd, appClass);
}

export async function openWebPalette(
  url: string,
  toggle: boolean,
  appClass: string,
  profile: string,
): Promise<void> {
  const hwnd = await findWindow(appClass);
  if (hwnd) {
    const active = await foregroundWindow(appClass);
    if (toggle && active === hwnd) await hidePalette(appClass);
    else await showWindow(hwnd, appClass);
    return;
  }
  const browser = findBrowser();
  if (!browser) throw new Error("Не найден Chromium-совместимый браузер; выберите режим браузера");
  mkdirSync(profile, { recursive: true });
  spawnDetached(browser, [
    `--app=${url}?surface=window`,
    `--user-data-dir=${profile}`,
    `--class=${appClass}`,
    "--window-size=660,500",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
  ]);
}

export async function closePalette(appClass: string): Promise<void> {
  const hwnd = await findWindow(appClass);
  if (hwnd) await closeWindow(hwnd, appClass);
}

export async function activateWindow(id: number | bigint): Promise<void> {
  await showWindow(String(id));
}

function windowHandle(handle: unknown): number | bigint | null {
  if (typeof handle === "bigint" || typeof handle === "number") return handle > 0 ? handle : null;
  const value = Number(handle);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Win32 foreground rules ignore a plain present(); raise the HWND explicitly. */
export async function activateSurface(surface: object): Promise<void> {
  try {
    const { default: GdkWin32 } = await import("gi:GdkWin32-4.0");
    const Win32Surface = (GdkWin32 as { Win32Surface?: abstract new () => object }).Win32Surface;
    if (!Win32Surface || !(surface instanceof Win32Surface)) return;
    const handle = windowHandle((surface as { getHandle(): unknown }).getHandle());
    if (handle !== null) await activateWindow(handle);
  } catch {
    /* The surface is not a Win32 window yet. */
  }
}
