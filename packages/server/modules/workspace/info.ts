import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { HttpError } from "../http/index.ts";
import { location, within } from "./paths.ts";

/** How long a folder scan may run before the answer says it is incomplete. */
export const INFO_TIME_LIMIT_MS = 4000;
/** Upper bound of visited entries for one answer; sizes of larger folders are partial. */
export const INFO_MAX_ENTRIES = 200_000;

export interface EntryInfo {
  path: string;
  name: string;
  directory: boolean;
  /** Sum of file sizes and symlink lengths; follows no symlinks. */
  size: number;
  files: number;
  directories: number;
  links: number;
  /** Entries that could not be read or were replaced during the scan. */
  skipped: number;
  /** Latest modification inside the tree, ISO 8601; null when nothing was read. */
  modified: string | null;
  /** True when the time or entry limit stopped the scan early. */
  truncated: boolean;
}

const newest = (current: Date, candidate: Date) =>
  candidate.getTime() > current.getTime() ? candidate : current;

/**
 * Size and contents of a file or folder. Symlinks are counted by their own length and never
 * followed; excluded and ignored entries are still included, because the answer is about disk use.
 */
export async function projectEntryInfo(root: string, path = ""): Promise<EntryInfo> {
  const base = await realpath(root);
  const full = await location(base, path);
  const entry = await lstat(full);
  if (!entry.isFile() && !entry.isDirectory() && !entry.isSymbolicLink())
    throw new HttpError(400, "Выберите файл или папку");
  const name = path ? path.split("/").filter(Boolean).at(-1)! : basename(base);
  if (!entry.isDirectory())
    return {
      path,
      name,
      directory: false,
      size: entry.size,
      files: entry.isFile() ? 1 : 0,
      directories: 0,
      links: entry.isSymbolicLink() ? 1 : 0,
      skipped: 0,
      modified: entry.mtime.toISOString(),
      truncated: false,
    };

  let size = 0;
  let files = 0;
  let directories = 0;
  let links = 0;
  let skipped = 0;
  let counted = 0;
  let modified = entry.mtime;
  let truncated = false;
  const deadline = Date.now() + INFO_TIME_LIMIT_MS;
  const pending = [full];

  async function children(directory: string) {
    try {
      const target = await realpath(directory);
      // A directory replaced by a symlink must not lead the scan outside the project.
      if (!within(base, target)) {
        skipped++;
        return [];
      }
      return await readdir(target, { withFileTypes: true });
    } catch {
      skipped++;
      return [];
    }
  }

  while (pending.length && !truncated) {
    const batch = pending.splice(0, 8);
    await Promise.all(
      batch.map(async (directory) => {
        const entries = await children(directory);
        // Chunking keeps the number of parallel stats bounded for folders with many files.
        for (let index = 0; index < entries.length && !truncated; index += 32) {
          await Promise.all(
            entries.slice(index, index + 32).map(async (child) => {
              if (counted >= INFO_MAX_ENTRIES || Date.now() >= deadline) {
                truncated = true;
                return;
              }
              counted++;
              const childPath = resolve(directory, child.name);
              try {
                const stat = await lstat(childPath);
                modified = newest(modified, stat.mtime);
                if (stat.isDirectory()) {
                  directories++;
                  pending.push(childPath);
                } else if (stat.isSymbolicLink()) {
                  links++;
                  size += stat.size;
                } else if (stat.isFile()) {
                  files++;
                  size += stat.size;
                } else skipped++;
              } catch {
                skipped++;
              }
            }),
          );
        }
      }),
    );
  }

  return {
    path,
    name,
    directory: true,
    size,
    files,
    directories,
    links,
    skipped,
    modified: modified.toISOString(),
    truncated,
  };
}
