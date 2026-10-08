import { createInterface } from "node:readline";
import type { ChildProcess } from "node:child_process";
import { descendants } from "./processes.ts";
import { spawnPowerShell } from "./ps.ts";

/**
 * A Job Object with KILL_ON_JOB_CLOSE, held by a small PowerShell process. Processes assigned to
 * it die when that process does, and it ends when its stdin closes, which is when the server
 * exits for any reason (including a crash). `taskkill` cannot give that guarantee.
 */
const host = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ProjectorJob {
  [StructLayout(LayoutKind.Sequential)] struct BASIC {
    public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct IO {
    public ulong a, b, c, d, e, f;
  }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED {
    public BASIC Basic; public IO Io; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXTENDED info, int size);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static IntPtr job;
  public static bool Init() {
    job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) return false;
    var info = new EXTENDED();
    info.Basic.LimitFlags = 0x2000;
    return SetInformationJobObject(job, 9, ref info, Marshal.SizeOf(typeof(EXTENDED)));
  }
  public static bool Assign(int pid) {
    var process = OpenProcess(0x0101, false, pid);
    if (process == IntPtr.Zero) return false;
    try { return AssignProcessToJobObject(job, process); } finally { CloseHandle(process); }
  }
}
"@
if (-not [ProjectorJob]::Init()) { [Console]::Out.WriteLine('failed'); exit 1 }
[Console]::Out.WriteLine('ready')
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $parts = $line.Trim().Split(' ')
  if ($parts.Length -eq 3 -and $parts[0] -eq 'assign') {
    $ok = [ProjectorJob]::Assign([int]$parts[2])
    [Console]::Out.WriteLine('result ' + $parts[1] + ' ' + $(if ($ok) { 'ok' } else { 'fail' }))
  }
}
`;

interface JobHost {
  child: ChildProcess;
  ready: Promise<boolean>;
  pending: Map<string, (ok: boolean) => void>;
}

let current: JobHost | undefined;
let nextId = 0;

function start(): JobHost {
  const child = spawnPowerShell(host);
  const pending = new Map<string, (ok: boolean) => void>();
  const lines = createInterface({ input: child.stdout! });
  child.stdin?.on("error", () => undefined);
  child.stderr?.resume();
  const ready = new Promise<boolean>((resolve) => {
    lines.on("line", (line) => {
      const text = line.trim();
      if (text === "ready") resolve(true);
      else if (text === "failed") resolve(false);
      const reply = /^result (\S+) (ok|fail)$/.exec(text);
      if (reply) pending.get(reply[1]!)?.(reply[2] === "ok");
    });
    child.once("exit", () => {
      resolve(false);
      for (const settle of [...pending.values()]) settle(false);
      if (current?.child === child) current = undefined;
    });
    child.once("error", () => resolve(false));
  });
  // The helper must not keep the server alive, and must go when the server does.
  child.unref();
  for (const pipe of [child.stdin, child.stdout, child.stderr])
    (pipe as unknown as { unref?: () => void } | null)?.unref?.();
  return { child, ready, pending };
}

/** Starts the helper ahead of the first assignment, so children are not created before it. */
export function warmJob(): Promise<boolean> {
  current ??= start();
  return current.ready;
}

/** Binds a process (and from now on its descendants) to the server's lifetime. */
export async function assignToJob(pid: number): Promise<boolean> {
  const job = (current ??= start());
  if (!(await job.ready) || !job.child.stdin?.writable) return false;
  const id = String(++nextId);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      job.pending.delete(id);
      resolve(false);
    }, 5000);
    job.pending.set(id, (ok) => {
      clearTimeout(timer);
      job.pending.delete(id);
      resolve(ok);
    });
    job.child.stdin!.write(`assign ${id} ${pid}\n`);
  });
}

/** Ends the helper, which closes the job and with it every assigned process. */
export function closeJob(): void {
  current?.child.stdin?.end();
  current?.child.kill();
  current = undefined;
}

/**
 * Binds a process and the children it already has: assigning only the root would leave a
 * `cmd.exe /c` wrapper's real program outside the job.
 */
export async function bindTreeToJob(pid: number): Promise<boolean> {
  if (!(await assignToJob(pid))) return false;
  let all = true;
  for (const entry of await descendants(pid))
    if (entry.pid !== pid) all = (await assignToJob(entry.pid)) && all;
  return all;
}
