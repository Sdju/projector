import { realpath } from "node:fs/promises";
import { os } from "@ai-projector/core/modules/os/index.ts";
import {
  isExcludedPath,
  rankPaths,
  type ProjectPath,
} from "@ai-projector/core/modules/workspace/index.ts";
import { HttpError } from "../http/index.ts";
import { MAX_BYTES, excludePatterns } from "./paths.ts";
import { git } from "./git.ts";
import { resolveRevision } from "./git-tree.ts";

export type { ProjectPath };

const CACHE_MS = 5000;
const MAX_PATHS = 50000;
const cache = new Map<string, { at: number; paths: ProjectPath[] }>();

function cacheKey(base: string, rev: string | undefined) {
  return `${base}\0${rev ?? ""}`;
}

function normalizeListedPath(path: string) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function pathsFromFiles(files: string[]): ProjectPath[] {
  const folders = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    for (let end = 1; end < parts.length; end++) folders.add(parts.slice(0, end).join("/"));
  }
  return [
    ...[...folders].map((path) => ({ path, directory: true })),
    ...files.map((path) => ({ path, directory: false })),
  ];
}

/** Every file of the project (what `rg --files` shows, honouring ignores). */
async function listLiveFiles(base: string): Promise<string[]> {
  const args = ["--files", "--hidden", "--no-require-git"];
  for (const pattern of await excludePatterns()) {
    args.push("--glob", `!${pattern}`);
    if (!pattern.endsWith("/**")) args.push("--glob", `!${pattern}/**`);
  }
  let output = "";
  try {
    output = (
      await os.tools.searchFiles(args, { cwd: base, maxBuffer: 16 * MAX_BYTES, timeout: 10000 })
    ).stdout;
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string };
    if (failure.code === "ENOENT") throw new HttpError(503, "Для поиска нужен ripgrep (rg)");
    // rg exits 1 for "nothing found" and 2 for partial errors; the partial list is still useful.
    output = failure.stdout ?? "";
  }
  return output.split("\n").map(normalizeListedPath).filter(Boolean).slice(0, MAX_PATHS);
}

/** Files of a committed tree, paths relative to the project folder. */
async function listGitFiles(root: string, rev: string): Promise<string[]> {
  const commit = await resolveRevision(root, rev);
  let output: string;
  try {
    // From a nested project folder git already names paths relative to that folder.
    output = await git(root, ["ls-tree", "-r", "--name-only", "-z", commit], 16 * MAX_BYTES);
  } catch {
    throw new HttpError(400, "Поиск по снимку недоступен. Уточните запрос.");
  }
  const patterns = await excludePatterns();
  const files: string[] = [];
  for (const row of output.split("\0")) {
    if (!row) continue;
    const path = normalizeListedPath(row);
    if (
      !path ||
      path.startsWith("/") ||
      path.split("/").includes("..") ||
      isExcludedPath(path, patterns)
    )
      continue;
    files.push(path);
    if (files.length >= MAX_PATHS) break;
  }
  return files;
}

async function listPaths(root: string, rev?: string): Promise<ProjectPath[]> {
  const base = await realpath(root);
  const key = cacheKey(base, rev);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.paths;
  const files = rev ? await listGitFiles(base, rev) : await listLiveFiles(base);
  const paths = pathsFromFiles(files);
  cache.set(key, { at: Date.now(), paths });
  return paths;
}

/** Files and folders of a project whose path matches `query`, best first. */
export async function findProjectPaths(root: string, query: string, limit = 30, rev?: string) {
  if (query.trim().length > 200) throw new HttpError(400, "Запрос длиннее 200 символов");
  const cap = Math.min(200, Math.max(1, Math.floor(limit) || 30));
  return rankPaths(await listPaths(root, rev), query, cap);
}
