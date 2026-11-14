import { lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Stats } from "node:fs";
import {
  TRASH_META_DIR,
  type TrashNode,
  type TrashDirectory,
  type TrashSize,
  type TrashSizes,
} from "@ai-projector/core/modules/workspace/index.ts";
import { HttpError } from "../http/index.ts";
import { within } from "./paths.ts";
import { trashRoot } from "./trash.ts";

/** Direct children one tree response returns; deeper content is fetched on expansion. */
const MAX_TRASH_CHILDREN = 5000;
/** One size request stays under these limits, so a huge trashed folder cannot hang the panel. */
const SIZE_TIME_LIMIT_MS = 8000;
const SIZE_MAX_ENTRIES = 500_000;
const SIZE_CACHE_LIMIT = 200;

const missing = (error: NodeJS.ErrnoException) => error.code === "ENOENT";

interface SizeBudget {
  entries: number;
  deadline: number;
}

const sizeCache = new Map<string, { size: number; files: number; truncated: boolean }>();

/** `key` is `<entry id>` or `<entry id>/<relative path>`; the trash root has an empty key. */
function trashPath(trash: string, key: string) {
  if (!key) return trash;
  const parts = key.split("/");
  if (
    parts[0]!.startsWith(".") ||
    parts.some(
      (part) =>
        !part || part === "." || part === ".." || part.includes("\\") || part.includes("\0"),
    )
  )
    throw new HttpError(400, "Некорректный путь корзины");
  const full = resolve(trash, ...parts);
  if (!within(trash, full)) throw new HttpError(403, "Некорректный путь корзины");
  return full;
}

const childKey = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);

async function trashChildren(trash: string, path: string) {
  const full = trashPath(trash, path);
  const info = await lstat(full).catch((error: NodeJS.ErrnoException) => {
    if (missing(error)) throw new HttpError(404, "Папка корзины больше не найдена");
    throw error;
  });
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new HttpError(400, "Выберите папку внутри корзины");
  const names = (await readdir(full)).filter(
    (name) => path || (name !== TRASH_META_DIR && !name.startsWith(".")),
  );
  const truncated = names.length > MAX_TRASH_CHILDREN;
  const entries: TrashNode[] = [];
  for (const name of names.slice(0, MAX_TRASH_CHILDREN)) {
    const childInfo = await lstat(resolve(full, name)).catch((error: NodeJS.ErrnoException) => {
      if (missing(error)) return undefined;
      throw error;
    });
    if (!childInfo) continue;
    entries.push({
      key: childKey(path, name),
      name,
      directory: childInfo.isDirectory(),
      size: childInfo.isDirectory() ? null : childInfo.size,
    });
  }
  entries.sort(
    (left, right) =>
      Number(right.directory) - Number(left.directory) || left.name.localeCompare(right.name),
  );
  return { entries, truncated };
}

/** One level of the trash tree: folders can be expanded by their `key`. */
export async function listProjectTrashDirectory(root: string, path = ""): Promise<TrashDirectory> {
  const found = await trashRoot(root);
  if (!found) return { path, entries: [], truncated: false };
  const { entries, truncated } = await trashChildren(found.trash, path);
  return { path, entries, truncated };
}

/** Sums file and symlink sizes under one folder; links are never followed. */
async function measureTrashFolder(full: string, info: Stats, budget: SizeBudget) {
  const cacheKey = `${full}\0${info.mtimeMs}\0${info.size}`;
  const cached = sizeCache.get(cacheKey);
  if (cached) {
    // Touch the entry: the map doubles as an LRU list.
    sizeCache.delete(cacheKey);
    sizeCache.set(cacheKey, cached);
    return { size: cached.size, files: cached.files, truncated: cached.truncated };
  }
  let size = 0;
  let files = 0;
  let truncated = false;
  const pending = [full];
  while (pending.length && !truncated) {
    const batch = pending.splice(0, 8);
    await Promise.all(
      batch.map(async (directory) => {
        let children;
        try {
          // Re-check the type: a folder replaced by a symlink must not lead outside the trash.
          const info = await lstat(directory);
          if (!info.isDirectory() || info.isSymbolicLink()) {
            truncated = true;
            return;
          }
          children = await readdir(directory, { withFileTypes: true });
        } catch {
          truncated = true;
          return;
        }
        for (const child of children) {
          if (budget.entries <= 0 || Date.now() >= budget.deadline) {
            truncated = true;
            return;
          }
          budget.entries--;
          const childPath = resolve(directory, child.name);
          try {
            const stat = await lstat(childPath);
            if (stat.isDirectory()) pending.push(childPath);
            else {
              files++;
              size += stat.size;
            }
          } catch {
            truncated = true;
          }
        }
      }),
    );
  }
  const value = { size, files, truncated };
  if (!value.truncated) sizeCache.set(cacheKey, value);
  if (sizeCache.size > SIZE_CACHE_LIMIT) {
    const oldest = sizeCache.keys().next().value;
    if (oldest) sizeCache.delete(oldest);
  }
  return value;
}

/** Recursive sizes of the direct children of a trash folder; used by the tree rows. */
export async function listProjectTrashSizes(root: string, path = ""): Promise<TrashSizes> {
  const found = await trashRoot(root);
  if (!found) return { path, sizes: [], truncated: false };
  const { entries, truncated: listingTruncated } = await trashChildren(found.trash, path);
  const budget: SizeBudget = {
    entries: SIZE_MAX_ENTRIES,
    deadline: Date.now() + SIZE_TIME_LIMIT_MS,
  };
  const sizes: TrashSize[] = [];
  let truncated = listingTruncated;
  for (const node of entries) {
    const full = resolve(found.trash, ...node.key.split("/"));
    if (!node.directory) {
      sizes.push({ key: node.key, size: node.size, files: 1, truncated: false });
      continue;
    }
    if (budget.entries <= 0 || Date.now() >= budget.deadline) {
      sizes.push({ key: node.key, size: null, files: 0, truncated: true });
      truncated = true;
      continue;
    }
    const info = await lstat(full).catch((error: NodeJS.ErrnoException) => {
      if (missing(error)) return undefined;
      throw error;
    });
    if (!info) {
      sizes.push({ key: node.key, size: null, files: 0, truncated: true });
      truncated = true;
      continue;
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
      sizes.push({ key: node.key, size: info.size, files: 1, truncated: false });
      continue;
    }
    const measured = await measureTrashFolder(full, info, budget);
    sizes.push({ key: node.key, ...measured });
    if (measured.truncated) truncated = true;
  }
  return { path, sizes, truncated };
}
