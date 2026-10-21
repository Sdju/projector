import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** What a folder looked like to git when a job started, to tell later what the job changed. */
export interface GitSnapshot {
  head: string;
  /** `git status --porcelain` lines by path. */
  dirty: Map<string, string>;
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await run("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout;
}

async function status(cwd: string): Promise<Map<string, string>> {
  const out = await git(cwd, ["status", "--porcelain", "-z", "--untracked-files=all"]);
  const entries = new Map<string, string>();
  const parts = out.split("\0").filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    const code = part.slice(0, 2);
    entries.set(part.slice(3), code);
    // A rename or copy lists its source as a separate entry.
    if (code[0] === "R" || code[0] === "C") index++;
  }
  return entries;
}

/** `undefined` when the folder is not in a git repository (the job's files then come from its calls). */
export async function snapshotGit(cwd: string): Promise<GitSnapshot | undefined> {
  try {
    const head = (await git(cwd, ["rev-parse", "--verify", "-q", "HEAD"]).catch(() => "")).trim();
    return { head, dirty: await status(cwd) };
  } catch {
    return undefined;
  }
}

/** The files that differ now from the snapshot: new changes, new commits. */
export async function changedSince(
  cwd: string,
  before: GitSnapshot | undefined,
): Promise<string[]> {
  if (!before) return [];
  try {
    const now = await status(cwd);
    const files = new Set<string>();
    for (const [path, code] of now) if (before.dirty.get(path) !== code) files.add(path);
    for (const path of before.dirty.keys()) if (!now.has(path)) files.add(path);
    if (before.head) {
      const committed = await git(cwd, ["diff", "--name-only", "-z", `${before.head}..HEAD`]).catch(
        () => "",
      );
      for (const path of committed.split("\0").filter(Boolean)) files.add(path);
    }
    return [...files];
  } catch {
    return [];
  }
}

const WRITING = new Set(["write", "edit", "multiedit", "notebookedit"]);

/** Paths a Claude-style write or edit call touched, relative to `root` when inside it. */
export function pathsOfCall(name: string, input: unknown, root: string): string[] {
  if (!WRITING.has(name.toLowerCase()) || !input || typeof input !== "object") return [];
  const data = input as Record<string, unknown>;
  const path = data.file_path ?? data.path ?? data.notebook_path;
  if (typeof path !== "string" || !path) return [];
  return [root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path];
}
