import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_BUFFER = 16 * 1024 * 1024;
/** The patch the agent reads: enough for a review, small enough for a model answer. */
export const PATCH_LIMIT = 60_000;
const SECRET_NAMES = new Set([".ssh", ".aws", ".npmrc", ".netrc", ".git-credentials"]);
const SECRET_PATTERNS = [/(^\.|\.)env($|\.)/i, /\.(pem|key)$/i, /^id_(rsa|ed25519)/i, /\.kdbx$/i];
const secretPath = (path: string) =>
  path
    .split("/")
    .some(
      (segment) =>
        SECRET_NAMES.has(segment.toLowerCase()) ||
        SECRET_PATTERNS.some((pattern) => pattern.test(segment)),
    );

async function git(cwd: string, args: string[]): Promise<string> {
  return (await run("git", args, { cwd, maxBuffer: MAX_BUFFER })).stdout;
}

/** `git diff --no-index` exits with 1 when files differ: its stdout is still the patch. */
async function noIndex(cwd: string, path: string): Promise<string> {
  try {
    return (
      await run("git", ["--no-pager", "diff", "--no-index", "--", "/dev/null", path], {
        cwd,
        maxBuffer: MAX_BUFFER,
      })
    ).stdout;
  } catch (error) {
    const stdout = (error as { stdout?: unknown }).stdout;
    return typeof stdout === "string" ? stdout : "";
  }
}

export interface JobDiff {
  /** Every changed non-secret path: tracked, staged and untracked. */
  files: string[];
  /** The `--stat` summary of tracked changes. */
  stat: string;
  /** Unified patch of tracked changes and new files. */
  patch: string;
  /** The patch was cut at the requested limit. */
  truncated: boolean;
}

/**
 * What a job changed in its folder. A job may have committed, staged or left files untracked, so
 * the patch is taken against HEAD and new files are appended as diffs from `/dev/null`.
 */
export async function jobDiff(
  cwd: string,
  limit = PATCH_LIMIT,
  base?: string,
  dirty: string[] = [],
): Promise<JobDiff> {
  if (!(await stat(cwd).catch(() => null))?.isDirectory())
    throw new Error("Папка задания не найдена");
  const cap = Math.min(Math.max(Math.trunc(limit) || PATCH_LIMIT, 1000), 200_000);
  const from = base || "HEAD";
  const dirtySet = new Set(dirty);
  // Paths that were already dirty when the job started are the user's work, not the job's.
  const paths = [".", ...dirty.map((path) => `:(exclude,literal)${path}`)];
  const files = new Set<string>();
  let summary = "";
  let patch = "";
  try {
    const output = await git(cwd, [
      "--no-pager",
      "diff",
      from,
      "--name-status",
      "-z",
      "--",
      ...paths,
    ]);
    const parts = output.split("\0").filter(Boolean);
    const changed: string[] = [];
    const secrets = new Set<string>();
    for (let index = 0; index < parts.length; index++) {
      const status = parts[index]!;
      if (status.startsWith("R") || status.startsWith("C")) {
        const before = parts[++index];
        const after = parts[++index];
        if (!before || !after) continue;
        if (secretPath(before) || secretPath(after)) {
          secrets.add(before);
          secrets.add(after);
        } else changed.push(after);
      } else {
        const path = parts[++index];
        if (!path) continue;
        if (secretPath(path)) secrets.add(path);
        else changed.push(path);
      }
    }
    const visible = [...paths, ...[...secrets].map((path) => `:(exclude,literal)${path}`)];
    for (const path of changed) files.add(path);
    summary = (await git(cwd, ["--no-pager", "diff", from, "--stat", "--", ...visible])).trim();
    patch = await git(cwd, ["--no-pager", "diff", from, "--", ...visible]);
  } catch {
    // Not a git repository or no commits yet: the files still come from the working tree.
  }
  let untracked: string[] = [];
  try {
    untracked = (await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]))
      .split("\0")
      .filter((path) => path && !dirtySet.has(path) && !secretPath(path));
  } catch {
    untracked = [];
  }
  for (const path of untracked) files.add(path);
  for (const path of untracked) {
    if (patch.length >= cap) break;
    patch += await noIndex(cwd, path);
  }
  const truncated = patch.length > cap;
  return {
    files: [...files].filter((path) => !dirtySet.has(path)).sort(),
    stat: summary,
    patch: truncated ? `${patch.slice(0, cap)}\n…` : patch,
    truncated,
  };
}
