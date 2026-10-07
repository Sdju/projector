import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runPowerShellSync } from "./ps.ts";

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

function spawnDetached(bin: string, args: string[]): void {
  const child = spawn(bin, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

function openDefault(url: string): void {
  spawnDetached("powershell.exe", [
    "-NoProfile",
    "-WindowStyle",
    "Hidden",
    "-Command",
    `Start-Process ${JSON.stringify(url)}`,
  ]);
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

function windowCall(env: Record<string, string>): string {
  try {
    return runPowerShellSync(WINDOW_HELPER, { timeout: 8000, env }).trim();
  } catch {
    return "";
  }
}

function paletteHwnd(appClass: string): string | null {
  const hwnd = windowCall({ PROJECTOR_WINDOW_OP: "find", PROJECTOR_APP_CLASS: appClass });
  return hwnd && hwnd !== "0" ? hwnd : null;
}

export function focusAppWindow(appClass: string): boolean {
  const hwnd = paletteHwnd(appClass);
  if (!hwnd) return false;
  windowCall({ PROJECTOR_WINDOW_OP: "show", PROJECTOR_HWND: hwnd, PROJECTOR_APP_CLASS: appClass });
  return true;
}

export function openOrFocusApp(url: string, appClass: string, profile: string): void {
  if (focusAppWindow(appClass)) return;
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

export function hidePalette(appClass: string): void {
  const hwnd = paletteHwnd(appClass);
  if (hwnd)
    windowCall({
      PROJECTOR_WINDOW_OP: "hide",
      PROJECTOR_HWND: hwnd,
      PROJECTOR_APP_CLASS: appClass,
    });
}

export function openWebPalette(
  url: string,
  toggle: boolean,
  appClass: string,
  profile: string,
): void {
  const hwnd = paletteHwnd(appClass);
  if (hwnd) {
    const active = windowCall({ PROJECTOR_WINDOW_OP: "foreground", PROJECTOR_APP_CLASS: appClass });
    if (toggle && active === hwnd) hidePalette(appClass);
    else
      windowCall({
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

export function closePalette(appClass: string): void {
  const hwnd = paletteHwnd(appClass);
  if (hwnd)
    windowCall({
      PROJECTOR_WINDOW_OP: "close",
      PROJECTOR_HWND: hwnd,
      PROJECTOR_APP_CLASS: appClass,
    });
}

export function activateWindow(id: number | bigint): void {
  windowCall({
    PROJECTOR_WINDOW_OP: "activate",
    PROJECTOR_HWND: String(id),
    PROJECTOR_APP_CLASS: "",
  });
}
