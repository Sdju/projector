import { readdirSync, readFileSync } from "node:fs";
import { readlink } from "node:fs/promises";
import type { ProcessInfo } from "../../contract.ts";

export function processInfo(pid: number): ProcessInfo | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const end = stat.lastIndexOf(")");
    const fields = stat.slice(end + 2).split(" ");
    return {
      pid,
      parent: Number(fields[1]),
      name: stat.slice(stat.indexOf("(") + 1, end),
      started: fields[19]!,
      state: fields[0]!,
      group: Number(fields[2]),
      foreground: Number(fields[5]),
    };
  } catch (error) {
    if (["ENOENT", "ESRCH", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? ""))
      return null;
    throw error;
  }
}
export function processIdentity(pid: number): string | null {
  const info = processInfo(pid);
  return info && info.state !== "Z" ? info.started : null;
}
export function listProcesses(): ProcessInfo[] | null {
  try {
    return readdirSync("/proc")
      .filter((name) => /^\d+$/.test(name))
      .flatMap((name) => {
        try {
          const info = processInfo(Number(name));
          return info ? [info] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return null;
  }
}
export function descendants(pid: number): ProcessInfo[] {
  const processes = listProcesses() ?? [];
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
export async function workingDirectory(pid: number, fallback: string): Promise<string> {
  const foreground = processInfo(pid)?.foreground ?? 0;
  try {
    return await readlink(`/proc/${foreground > 0 ? foreground : pid}/cwd`);
  } catch {
    try {
      return await readlink(`/proc/${pid}/cwd`);
    } catch {
      return fallback;
    }
  }
}

export function signalProcess(pid: number, signal: NodeJS.Signals): void {
  process.kill(pid, signal);
}

/** Linux parents every program to its shell; nothing needs tracking. */
export function trackConsole(_pid: number): void {}
export function untrackConsole(_pid: number): void {}

export const recentProcesses = (_maxAgeMs: number): ProcessInfo[] | null => listProcesses();

export async function workingDirectories(pid: number, fallback: string): Promise<string[]> {
  return [await workingDirectory(pid, fallback)];
}
