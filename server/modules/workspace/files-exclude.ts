import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "../../../core/modules/app-paths/index.ts";
import {
  activeExcludePatterns,
  defaultFilesExclude,
  isExcludedPath,
  normalizeFilesExclude,
  type FilesExcludeMap,
} from "../../../core/modules/workspace/index.ts";

const settingsPath = () => join(dataDir(), "files-exclude.json");
const override = new AsyncLocalStorage<FilesExcludeMap>();
let pending: Promise<unknown> = Promise.resolve();
let cache: { path: string; value: FilesExcludeMap; patterns?: string[] } | undefined;

/** Run workspace code against an in-memory exclude map (parallel-safe in tests). */
export function withFilesExclude<T>(
  exclude: FilesExcludeMap,
  run: () => Promise<T> | T,
): Promise<T> {
  return override.run(normalizeFilesExclude(exclude), () => Promise.resolve(run()));
}

export async function readFilesExclude(): Promise<FilesExcludeMap> {
  const local = override.getStore();
  if (local) return { ...local };
  const path = settingsPath();
  if (cache?.path === path) return { ...cache.value };
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    cache = { path, value: normalizeFilesExclude(data?.exclude ?? data) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    cache = { path, value: defaultFilesExclude() };
  }
  return { ...cache.value };
}

export async function writeFilesExclude(input: unknown): Promise<FilesExcludeMap> {
  const exclude = normalizeFilesExclude(input);
  const local = override.getStore();
  if (local) {
    Object.keys(local).forEach((key) => delete local[key]);
    Object.assign(local, exclude);
    return { ...local };
  }
  const task = pending.then(async () => {
    await mkdir(dataDir(), { recursive: true });
    const path = settingsPath();
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ exclude }, null, 2) + "\n", { mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    cache = { path, value: exclude };
    return { ...exclude };
  });
  pending = task.catch(() => undefined);
  return task;
}

export async function excludePatterns(): Promise<string[]> {
  const local = override.getStore();
  if (local) return activeExcludePatterns(local);
  const path = settingsPath();
  const value = await readFilesExclude();
  if (cache?.path === path && cache.patterns) return cache.patterns;
  const patterns = activeExcludePatterns(value);
  if (cache?.path === path) cache.patterns = patterns;
  return patterns;
}

export async function pathIsExcluded(path: string): Promise<boolean> {
  return isExcludedPath(path, await excludePatterns());
}
