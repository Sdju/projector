import type { ProcessInfo } from "../../contract.ts";
import { runPowerShell } from "./ps.ts";

function normalizeName(name: string) {
  return name.replace(/\.exe$/i, "").toLowerCase();
}

function parseLine(line: string): ProcessInfo | null {
  const [pid, parent, name, started] = line.split("\t");
  const id = Number(pid);
  if (!Number.isSafeInteger(id) || id <= 0 || !name || !started) return null;
  // The console host is plumbing around every PTY, not a program the user started.
  if (/^(?:conhost|openconsole)$/.test(normalizeName(name))) return null;
  return {
    pid: id,
    parent: Number(parent) || 0,
    name: normalizeName(name),
    started,
    state: "S",
    group: null,
    foreground: null,
  };
}

const ROW =
  "Write-Output ($p.ProcessId.ToString() + [char]9 + $p.ParentProcessId.ToString() + [char]9 + $name + [char]9 + $p.CreationDate.ToFileTime().ToString())";

const LIST_SCRIPT = `
Get-CimInstance Win32_Process | ForEach-Object {
  $p = $_
  if ($p.ProcessId -gt 0 -and $p.CreationDate) {
    $name = $p.Name -replace '[\\r\\n]', ' '
    ${ROW}
  }
}
`;

/**
 * MSYS/Cygwin `exec` leaves the new program with a dead Win32 parent, so the parent chain loses
 * every command run from Git Bash. The processes attached to a pseudo console are the reliable
 * answer: that is what GetConsoleProcessList reports for the console of a tracked shell.
 */
const CONSOLE_SCRIPT = `
if ($env:PROJECTOR_CONSOLE_ROOTS) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ProjectorConsole {
  [DllImport("kernel32.dll")] static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint GetConsoleProcessList(uint[] list, uint count);
  public static string Members(uint pid) {
    FreeConsole();
    if (!AttachConsole(pid)) return "";
    try {
      var list = new uint[512];
      uint n = GetConsoleProcessList(list, (uint)list.Length);
      if (n == 0 || n > list.Length) return "";
      var ids = new string[n];
      for (int i = 0; i < n; i++) ids[i] = list[i].ToString();
      return string.Join(",", ids);
    } finally { FreeConsole(); }
  }
}
"@
  foreach ($root in $env:PROJECTOR_CONSOLE_ROOTS.Split(',')) {
    $members = [ProjectorConsole]::Members([uint32]$root)
    if ($members) { Write-Output ('console' + [char]9 + $root + [char]9 + $members) }
  }
}
`;

const ONE_SCRIPT = `
$p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $env:PROJECTOR_PID)
if (-not $p -or -not $p.CreationDate) { exit 2 }
$name = $p.Name -replace '[\\r\\n]', ' '
${ROW}
`;

let snapshot: { at: number; rows: ProcessInfo[] } | null = null;
let refreshing: Promise<ProcessInfo[] | null> | null = null;
/** Freshness for exact answers (kill lists, identity of unknown pids). */
const TTL = 400;
/** How old a listing may be before polling callers trigger a background refresh. */
const STALE = 1500;

const consoleRoots = new Set<number>();

/** Shells whose pseudo console is inspected for programs Win32 does not parent to them. */
export function trackConsole(pid: number): void {
  consoleRoots.add(pid);
  void refresh();
}
export function untrackConsole(pid: number): void {
  consoleRoots.delete(pid);
}

function parseRows(stdout: string): ProcessInfo[] {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim());
  const rows = lines
    .map((line) => parseLine(line))
    .filter((entry): entry is ProcessInfo => entry !== null);
  const pids = new Set(rows.map((row) => row.pid));
  for (const line of lines) {
    const [tag, root, members] = line.split("\t");
    if (tag !== "console" || !root || !members) continue;
    const attached = new Set(members.split(",").map(Number));
    for (const row of rows)
      if (attached.has(row.pid) && row.pid !== Number(root) && !attached.has(row.parent))
        row.parent = pids.has(Number(root)) ? Number(root) : row.parent;
  }
  return rows;
}

function refresh(): Promise<ProcessInfo[] | null> {
  refreshing ??= runPowerShell(LIST_SCRIPT + CONSOLE_SCRIPT, {
    env: { PROJECTOR_CONSOLE_ROOTS: [...consoleRoots].join(",") },
  })
    .then(({ stdout }) => {
      const rows = parseRows(stdout);
      snapshot = { at: Date.now(), rows };
      return rows;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * Polling view that never blocks and never spawns anything itself on the caller's time: the last
 * known listing is returned at once and a stale one starts a background refresh. Before the first
 * listing exists it is null.
 */
export function snapshotProcesses(): ProcessInfo[] | null {
  if (!snapshot || Date.now() - snapshot.at >= STALE) void refresh();
  return snapshot?.rows ?? null;
}

/** Exact view, for deciding what to signal: at most TTL old. */
export async function listProcesses(): Promise<ProcessInfo[] | null> {
  if (snapshot && Date.now() - snapshot.at < TTL) return snapshot.rows;
  return refresh();
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export async function processInfo(pid: number): Promise<ProcessInfo | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  // A cached listing may still hold a process that has just exited.
  if (!alive(pid)) return null;
  if (snapshot && Date.now() - snapshot.at < TTL)
    return snapshot.rows.find((entry) => entry.pid === pid) ?? null;
  try {
    const { stdout } = await runPowerShell(ONE_SCRIPT, {
      env: { PROJECTOR_PID: String(pid) },
      timeout: 8000,
    });
    const row = parseLine(stdout.trim());
    return row?.pid === pid ? row : null;
  } catch {
    return null;
  }
}

export async function processIdentity(pid: number): Promise<string | null> {
  return (await processInfo(pid))?.started ?? null;
}

export async function descendants(pid: number): Promise<ProcessInfo[]> {
  const processes = (await listProcesses()) ?? [];
  const family = new Set([pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of processes)
      if (family.has(entry.parent) && !family.has(entry.pid)) {
        family.add(entry.pid);
        changed = true;
      }
  }
  return processes.filter((entry) => family.has(entry.pid));
}

/** Only POSIX can answer synchronously; Windows callers use `descendants`. */
export function descendantsSync(): never {
  throw new Error("Синхронный список потомков недоступен на Windows");
}

export function signalProcess(pid: number, signal: NodeJS.Signals): void {
  process.kill(pid, signal);
}

const CWD_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ProjectorCwd {
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_BASIC_INFORMATION {
    public IntPtr Reserved1;
    public IntPtr PebBaseAddress;
    public IntPtr Reserved2_0;
    public IntPtr Reserved2_1;
    public IntPtr UniqueProcessId;
    public IntPtr InheritedFromUniqueProcessId;
  }
  [DllImport("ntdll.dll")]
  static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PROCESS_BASIC_INFORMATION info, int len, out int ret);
  [DllImport("kernel32.dll")]
  static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")]
  static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out IntPtr read);
  static IntPtr ReadPtr(IntPtr h, IntPtr addr) {
    var buf = new byte[8];
    IntPtr read;
    if (!ReadProcessMemory(h, addr, buf, 8, out read)) throw new Exception("read");
    return new IntPtr(BitConverter.ToInt64(buf, 0));
  }
  public static string Read(int pid) {
    var handle = OpenProcess(0x0410, false, pid);
    if (handle == IntPtr.Zero) throw new Exception("open");
    try {
      var info = new PROCESS_BASIC_INFORMATION();
      int ret;
      if (NtQueryInformationProcess(handle, 0, ref info, Marshal.SizeOf(info), out ret) != 0)
        throw new Exception("nt");
      var parameters = ReadPtr(handle, info.PebBaseAddress + 0x20);
      var header = new byte[16];
      IntPtr read;
      if (!ReadProcessMemory(handle, parameters + 0x38, header, 16, out read)) throw new Exception("cur");
      int length = BitConverter.ToUInt16(header, 0);
      var buffer = new IntPtr(BitConverter.ToInt64(header, 8));
      var chars = new byte[length];
      if (!ReadProcessMemory(handle, buffer, chars, length, out read)) throw new Exception("path");
      return Encoding.Unicode.GetString(chars);
    } finally { CloseHandle(handle); }
  }
}
"@
[ProjectorCwd]::Read([int]$env:PROJECTOR_PID)
`;

function normalizeDirectory(path: string) {
  const stripped = path.replace(/^\\\?\?\\/, "").replace(/^\\\\\?\\/, "");
  if (/^[A-Za-z]:\\$/.test(stripped)) return stripped;
  return stripped.replace(/[\\/]+$/, "");
}

/**
 * Git's `bin\\bash.exe` is a launcher that starts the real shell as a child and never changes
 * directory itself. The deepest descendant with the same name is the shell the user is typing in.
 */
async function shellProcess(pid: number): Promise<number> {
  const root = await processInfo(pid);
  if (!root) return pid;
  let current = pid;
  for (const entry of await descendants(pid))
    if (entry.name === root.name && entry.parent === current) current = entry.pid;
  return current;
}

export async function workingDirectory(pid: number, fallback: string): Promise<string> {
  if (!(await processInfo(pid))) return fallback;
  pid = await shellProcess(pid);
  try {
    const { stdout } = await runPowerShell(CWD_SCRIPT, {
      env: { PROJECTOR_PID: String(pid) },
      timeout: 8000,
    });
    const directory = normalizeDirectory(stdout.trim());
    return directory || fallback;
  } catch {
    return fallback;
  }
}
