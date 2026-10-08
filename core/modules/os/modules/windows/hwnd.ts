import { runPowerShell } from "./ps.ts";

/**
 * The only place that touches HWNDs. The GTK palette (via its GdkWin32 surface), the Chromium
 * app windows (found by the marker in their command line) and the tray all go through here.
 */
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

export async function findWindow(appClass: string): Promise<string | null> {
  const hwnd = await windowCall({ PROJECTOR_WINDOW_OP: "find", PROJECTOR_APP_CLASS: appClass });
  return hwnd && hwnd !== "0" ? hwnd : null;
}

export const showWindow = (hwnd: string, appClass = "") =>
  windowCall({ PROJECTOR_WINDOW_OP: "show", PROJECTOR_HWND: hwnd, PROJECTOR_APP_CLASS: appClass });
export const hideWindow = (hwnd: string, appClass = "") =>
  windowCall({ PROJECTOR_WINDOW_OP: "hide", PROJECTOR_HWND: hwnd, PROJECTOR_APP_CLASS: appClass });
export const closeWindow = (hwnd: string, appClass = "") =>
  windowCall({ PROJECTOR_WINDOW_OP: "close", PROJECTOR_HWND: hwnd, PROJECTOR_APP_CLASS: appClass });
export const foregroundWindow = (appClass: string) =>
  windowCall({ PROJECTOR_WINDOW_OP: "foreground", PROJECTOR_APP_CLASS: appClass });
export const activateHwnd = (hwnd: string) =>
  windowCall({ PROJECTOR_WINDOW_OP: "activate", PROJECTOR_HWND: hwnd, PROJECTOR_APP_CLASS: "" });
