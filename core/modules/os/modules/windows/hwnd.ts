import { createInterface } from "node:readline";
import type { ChildProcess } from "node:child_process";
import { spawnPowerShell } from "./ps.ts";

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
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT point, uint flags);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct MONITORINFO {
    public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
  }
  static ProjectorWindows() { try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { } }
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
  public static void Place(long hwnd) {
    var h = new IntPtr(hwnd);
    RECT rect;
    POINT point;
    var monitor = GetCursorPos(out point) ? MonitorFromPoint(point, 2) : MonitorFromWindow(h, 2);
    var info = new MONITORINFO();
    info.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (GetWindowRect(h, out rect) && monitor != IntPtr.Zero && GetMonitorInfo(monitor, ref info)) {
      int width = rect.Right - rect.Left;
      int height = rect.Bottom - rect.Top;
      int x = info.rcWork.Left + (info.rcWork.Right - info.rcWork.Left - width) / 2;
      int y = info.rcWork.Top + (info.rcWork.Bottom - info.rcWork.Top - height) / 2;
      // TOPMOST, then NOTOPMOST. Both are async so the GTK thread is not waited on.
      SetWindowPos(h, new IntPtr(-1), x, y, 0, 0, 0x4041);
      SetWindowPos(h, new IntPtr(-2), 0, 0, 0, 0, 0x4003);
    }
  }
  public static void Hide(long hwnd) { ShowWindow(new IntPtr(hwnd), 0); }
  public static void Close(long hwnd) { PostMessage(new IntPtr(hwnd), 0x0010, IntPtr.Zero, IntPtr.Zero); }
}
"@
function Emit([string]$text) {
  [Console]::Out.WriteLine($text)
  [Console]::Out.Flush()
}
Emit "ready"
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq "quit") { break }
  $parts = $line.Trim().Split(" ".ToCharArray(), 3)
  if ($parts.Length -lt 2) { continue }
  $id = $parts[0]
  $op = $parts[1]
  $arg = if ($parts.Length -ge 3) { $parts[2] } else { "" }
  $result = ""
  try {
    switch ($op) {
      "find" {
        $marker = "--class=" + $arg
        $pids = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($marker) } | ForEach-Object { $_.ProcessId }) -join ","
        if ($pids) { $result = [ProjectorWindows]::Find($pids) }
      }
      "foreground" { $result = [ProjectorWindows]::Foreground() }
      "show" { [ProjectorWindows]::Show([int64]$arg) }
      "place" { [ProjectorWindows]::Place([int64]$arg) }
      "hide" { [ProjectorWindows]::Hide([int64]$arg) }
      "close" { [ProjectorWindows]::Close([int64]$arg) }
    }
  } catch {}
  Emit "done $id $result"
}
`;

interface Pending {
  resolve: (value: string) => void;
  timer: ReturnType<typeof setTimeout>;
}
let host: ChildProcess | undefined;
let input: NodeJS.WritableStream | undefined;
let pending = new Map<string, Pending>();
let nextId = 0;
let ready: Promise<void> | undefined;
const defaultSpawn = () => spawnPowerShell(WINDOW_HELPER);
let spawnHost = defaultSpawn;

function report(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  if (text) console.error("Окно:", text);
}

function failPending() {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.resolve("");
  }
  pending = new Map();
}

function dropHost(proc: ChildProcess) {
  if (host !== proc) return;
  host = undefined;
  input = undefined;
  ready = undefined;
}

/** One PowerShell process: compiling the Win32 helper on every show left the palette invisible for seconds. */
function startHost(): Promise<void> {
  if (ready && host && host.exitCode === null && !host.signalCode) return ready;
  const proc = spawnHost();
  proc.unref();
  host = proc;
  // Importing the OS facade on Linux must not register Windows process hooks.
  const stopOnExit = () => proc.kill();
  process.once("exit", stopOnExit);
  proc.once("close", () => process.off("exit", stopOnExit));
  ready = new Promise((resolve, reject) => {
    const stdin = proc.stdin;
    const stdout = proc.stdout;
    // The process lives as long as the resident. An unread stderr pipe fills and blocks PowerShell.
    let noted = false;
    proc.stderr?.on("data", (chunk: Buffer) => {
      if (noted) return;
      const text = chunk.toString().trim();
      if (!text) return;
      noted = true;
      console.error("Окно:", text.slice(0, 500));
    });
    let opened = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (error?: Error) => {
      if (opened) return;
      opened = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    proc.once("error", (error) => {
      settle(error);
    });
    proc.once("exit", () => {
      failPending();
      settle(new Error("window helper exited"));
      dropHost(proc);
    });
    if (!stdin || !stdout) {
      settle(new Error("window helper stdio"));
      return;
    }
    input = stdin;
    stdin.on("error", () => undefined);
    const lines = createInterface({ input: stdout });
    timer = setTimeout(() => {
      proc.kill();
      settle(new Error("window helper timeout"));
    }, 8000);
    lines.on("line", (line) => {
      const text = line.trim();
      if (text === "ready") {
        settle();
        return;
      }
      const match = /^done (\S+)(?: (.*))?$/.exec(text);
      if (!match) return;
      const request = pending.get(match[1]!);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(match[1]!);
      request.resolve((match[2] ?? "").trim());
    });
  });
  ready.catch((error: unknown) => {
    report(error);
    dropHost(proc);
  });
  return ready;
}

/** Tests stand in for PowerShell. `null` restores the real helper. */
export function setWindowHostSpawn(spawn: (() => ChildProcess) | null): void {
  spawnHost = spawn ?? defaultSpawn;
}

export function windowHostPid(): number | undefined {
  return host && host.exitCode === null && !host.signalCode ? host.pid : undefined;
}

export async function stopWindowHost(): Promise<void> {
  const proc = host;
  const stdin = input;
  if (!proc || proc.exitCode !== null || proc.signalCode) {
    if (proc) dropHost(proc);
    proc?.stdin?.destroy();
    proc?.stdout?.destroy();
    proc?.stderr?.destroy();
    return;
  }
  stdin?.write("quit\n");
  stdin?.end();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      proc.kill();
      resolve();
    }, 1000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  proc.stdin?.destroy();
  proc.stdout?.destroy();
  proc.stderr?.destroy();
}

export function warmWindowHelper(): void {
  void startHost().catch(() => undefined);
}

export async function windowCall(op: string, arg = ""): Promise<string> {
  try {
    await startHost();
    const stdin = input;
    if (!stdin) return "";
    const id = String(++nextId);
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve("");
      }, 8000);
      pending.set(id, { resolve, timer });
      stdin.write(`${id} ${op} ${arg}\n`);
    });
  } catch {
    return "";
  }
}

export async function findWindow(appClass: string): Promise<string | null> {
  const hwnd = await windowCall("find", appClass);
  return hwnd && hwnd !== "0" ? hwnd : null;
}

/** Show, place, hide and close take an HWND. A class name used to be substituted and killed the helper. */
function hwndCall(op: string, hwnd: string): Promise<string> {
  return /^-?\d+$/.test(hwnd) ? windowCall(op, hwnd) : Promise.resolve("");
}

export const showWindow = (hwnd: string) => hwndCall("show", hwnd);
/** Center on the work area of the monitor under the cursor, then raise. */
export const placeWindow = (hwnd: string) => hwndCall("place", hwnd);
export const hideWindow = (hwnd: string) => hwndCall("hide", hwnd);
export const closeWindow = (hwnd: string) => hwndCall("close", hwnd);
export const foregroundWindow = (appClass: string) => windowCall("foreground", appClass);
