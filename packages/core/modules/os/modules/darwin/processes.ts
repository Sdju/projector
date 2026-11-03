import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import type { ProcessInfo } from "../../contract.ts";

const execute = promisify(execFile);
// lstart is always five words: "Thu Oct  9 12:00:00 2026".
const COLUMNS = "pid=,ppid=,pgid=,tpgid=,stat=,lstart=,comm=";
const LINE =
  /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/;

function parse(output: string): ProcessInfo[] {
  return output.split("\n").flatMap((line) => {
    const match = LINE.exec(line);
    if (!match) return [];
    const foreground = Number(match[4]);
    return [
      {
        pid: Number(match[1]),
        parent: Number(match[2]),
        name: match[7]!.split("/").pop()!,
        started: match[6]!,
        state: match[5]![0]!,
        group: Number(match[3]),
        foreground: foreground > 0 ? foreground : null,
      },
    ];
  });
}

export function listProcesses(): ProcessInfo[] | null {
  try {
    return parse(
      execFileSync("ps", ["-axo", COLUMNS], {
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C" },
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
  } catch {
    return null;
  }
}
export function processInfo(pid: number): ProcessInfo | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    return (
      parse(
        execFileSync("ps", ["-p", String(pid), "-o", COLUMNS], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          env: { ...process.env, LC_ALL: "C" },
        }),
      )[0] ?? null
    );
  } catch {
    return null;
  }
}
export function processIdentity(pid: number): string | null {
  const info = processInfo(pid);
  return info && info.state !== "Z" ? info.started : null;
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

async function cwdOf(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execute("lsof", ["-a", "-d", "cwd", "-p", String(pid), "-Fn"], {
      timeout: 5000,
    });
    return (
      stdout
        .split("\n")
        .find((line) => line.startsWith("n"))
        ?.slice(1) || null
    );
  } catch {
    return null;
  }
}
export async function workingDirectory(pid: number, fallback: string): Promise<string> {
  const foreground = processInfo(pid)?.foreground ?? 0;
  return (foreground > 0 ? await cwdOf(foreground) : null) ?? (await cwdOf(pid)) ?? fallback;
}
export async function workingDirectories(pid: number, fallback: string): Promise<string[]> {
  return [await workingDirectory(pid, fallback)];
}

export function signalProcess(pid: number, signal: NodeJS.Signals): void {
  process.kill(pid, signal);
}
/** macOS parents every program to its shell; nothing needs tracking. */
export function trackConsole(_pid: number): void {}
export function untrackConsole(_pid: number): void {}
export const recentProcesses = (_maxAgeMs: number): ProcessInfo[] | null => listProcesses();
