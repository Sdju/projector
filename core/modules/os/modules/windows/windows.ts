import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runPowerShell } from "./ps.ts";

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

const WINDOW_HELPER = `
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class ProjectorWindows {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc lp, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
  public static string Find(string pids) {
    var wanted = new HashSet<uint>();
    foreach (var part in pids.Split(',')) { uint id; if (uint.TryParse(part, out id)) wanted.Add(id); }
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (wanted.Contains(pid) && GetWindowTextLength(h) > 0) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found.ToInt64().ToString();
  }
  public static string Foreground() { return GetForegroundWindow().ToInt64().ToString(); }
  public static void Show(long hwnd) { var h = new IntPtr(hwnd); ShowWindow(h, 9); SetForegroundWindow(h); }
  public static void Hide(long hwnd) { ShowWindow(new IntPtr(hwnd), 0); }
  public static void Close(long hwnd) { PostMessage(new IntPtr(hwnd), 0x0010, IntPtr.Zero, IntPtr.Zero); }
  public static void Activate(long hwnd) { var h = new IntPtr(hwnd); ShowWindow(h, 9); SetForegroundWindow(h); }
}
"@
$marker = '--class=' + $env:PROJECTOR_APP_CLASS
$pids = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($marker) } | ForEach-Object { $_.ProcessId }) -join ','
switch ($env:PROJECTOR_WINDOW_OP) {
  'find' { if ($pids) { [ProjectorWindows]::Find($pids) } }
  'foreground' { [ProjectorWindows]::Foreground() }
  'show' { $h = [int64]$env:PROJECTOR_HWND; [ProjectorWindows]::Show($h) }
  'hide' { $h = [int64]$env:PROJECTOR_HWND; [ProjectorWindows]::Hide($h) }
  'close' { $h = [int64]$env:PROJECTOR_HWND; [ProjectorWindows]::Close($h) }
  'activate' { $h = [int64]$env:PROJECTOR_HWND; [ProjectorWindows]::Activate($h) }
}
`;

async function windowCall(env: Record<string, string>): Promise<string> {
  try {
    return (await runPowerShell(WINDOW_HELPER, { timeout: 8000, env })).stdout.trim();
  } catch {
    return "";
  }
}

async function paletteHwnd(appClass: string): Promise<string | null> {
  const hwnd = await windowCall({ PROJECTOR_WINDOW_OP: "find", PROJECTOR_APP_CLASS: appClass });
  return hwnd && hwnd !== "0" ? hwnd : null;
}

export async function focusAppWindow(appClass: string): Promise<boolean> {
  const hwnd = await paletteHwnd(appClass);
  if (!hwnd) return false;
  await windowCall({
    PROJECTOR_WINDOW_OP: "show",
    PROJECTOR_HWND: hwnd,
    PROJECTOR_APP_CLASS: appClass,
  });
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
  const hwnd = await paletteHwnd(appClass);
  if (hwnd)
    await windowCall({
      PROJECTOR_WINDOW_OP: "hide",
      PROJECTOR_HWND: hwnd,
      PROJECTOR_APP_CLASS: appClass,
    });
}

export async function openWebPalette(
  url: string,
  toggle: boolean,
  appClass: string,
  profile: string,
): Promise<void> {
  const hwnd = await paletteHwnd(appClass);
  if (hwnd) {
    const active = await windowCall({
      PROJECTOR_WINDOW_OP: "foreground",
      PROJECTOR_APP_CLASS: appClass,
    });
    if (toggle && active === hwnd) await hidePalette(appClass);
    else
      await windowCall({
        PROJECTOR_WINDOW_OP: "show",
        PROJECTOR_HWND: hwnd,
        PROJECTOR_APP_CLASS: appClass,
      });
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
  const hwnd = await paletteHwnd(appClass);
  if (hwnd)
    await windowCall({
      PROJECTOR_WINDOW_OP: "close",
      PROJECTOR_HWND: hwnd,
      PROJECTOR_APP_CLASS: appClass,
    });
}

export async function activateWindow(id: number | bigint): Promise<void> {
  await windowCall({
    PROJECTOR_WINDOW_OP: "activate",
    PROJECTOR_HWND: String(id),
    PROJECTOR_APP_CLASS: "",
  });
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
