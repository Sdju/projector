import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { os } from "@ai-projector/core/modules/os/index.ts";
import {
  parentPath,
  restoredName,
  TRASH_DIR,
  TRASH_META_DIR,
  trashEntryName,
  type TrashEntry,
  type TrashList,
  type TrashMutation,
  type TrashRestore,
} from "@ai-projector/core/modules/workspace/index.ts";
import { HttpError } from "../http/index.ts";
import { pathExcluded, validatePath, within } from "./paths.ts";

/** What a trashed entry remembers besides its bytes. */
export interface TrashRecord {
  /** Project-relative path before deletion. */
  path: string;
  deletedAt: string;
}

const missing = (error: NodeJS.ErrnoException) => error.code === "ENOENT";

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (missing(error)) return false;
      throw error;
    },
  );

/** Name of a new trash entry: a unique prefix plus the old base name keeps the folder browsable. */
export function trashEntryId(path: string) {
  return `${randomUUID()}-${path.split("/").at(-1)}`;
}

/** Metadata lives next to the entries and disappears with them; a failed write only loses the path. */
export async function recordTrashEntry(trash: string, id: string, record: TrashRecord) {
  const meta = resolve(trash, TRASH_META_DIR);
  await mkdir(meta, { recursive: true, mode: 0o700 });
  const temporary = resolve(meta, `${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
  await rename(temporary, resolve(meta, `${id}.json`));
}

async function readTrashRecord(trash: string, id: string): Promise<TrashRecord | undefined> {
  try {
    const value = JSON.parse(
      await readFile(resolve(trash, TRASH_META_DIR, `${id}.json`), "utf8"),
    ) as Partial<TrashRecord>;
    if (typeof value.path === "string" && typeof value.deletedAt === "string")
      return { path: value.path, deletedAt: value.deletedAt };
  } catch {
    // A missing or broken record is not an error: the entry name still holds the old base name.
  }
  return undefined;
}

async function forgetTrashEntry(trash: string, id: string) {
  await unlink(resolve(trash, TRASH_META_DIR, `${id}.json`)).catch(() => undefined);
}

/** The trash root, or undefined while nothing was ever deleted. A symlinked trash is refused. */
export async function trashRoot(root: string) {
  const base = await realpath(root);
  const trash = resolve(base, TRASH_DIR);
  const info = await lstat(trash).catch((error: NodeJS.ErrnoException) => {
    if (missing(error)) return undefined;
    throw error;
  });
  if (!info) return undefined;
  const real = await realpath(trash);
  if (!info.isDirectory() || info.isSymbolicLink() || real !== trash)
    throw new HttpError(403, "Некорректная папка корзины");
  return { base, trash };
}

/** Project-like paths only; metadata is not trusted to point outside the project. */
function recordedPath(value: string) {
  return (
    !!value &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.split("/").some((part) => !part || part === "." || part === "..")
  );
}

async function trashEntries(trash: string): Promise<TrashEntry[]> {
  const names = await readdir(trash);
  const entries: TrashEntry[] = [];
  for (const id of names) {
    if (id === TRASH_META_DIR || id.startsWith(".")) continue;
    const info = await lstat(resolve(trash, id)).catch((error: NodeJS.ErrnoException) => {
      if (missing(error)) return undefined;
      throw error;
    });
    if (!info) continue;
    const record = await readTrashRecord(trash, id);
    const path = record && recordedPath(record.path) ? record.path : trashEntryName(id);
    entries.push({
      id,
      path,
      name: path.split("/").at(-1) || path,
      directory: info.isDirectory(),
      deletedAt: record?.deletedAt ?? info.ctime.toISOString(),
      size: info.isDirectory() ? null : info.size,
    });
  }
  entries.sort(
    (left, right) =>
      right.deletedAt.localeCompare(left.deletedAt) || left.id.localeCompare(right.id),
  );
  return entries;
}

export async function listProjectTrash(root: string): Promise<TrashList> {
  const found = await trashRoot(root);
  return { entries: found ? await trashEntries(found.trash) : [] };
}

function entryPath(trash: string, id: string) {
  if (!id || id.startsWith(".") || id.includes("/") || id.includes("\\") || id.includes("\0"))
    throw new HttpError(400, "Некорректная запись корзины");
  const full = resolve(trash, id);
  if (!within(trash, full)) throw new HttpError(403, "Некорректная запись корзины");
  return full;
}

async function existingEntry(trash: string, id: string) {
  const full = entryPath(trash, id);
  const info = await lstat(full).catch((error: NodeJS.ErrnoException) => {
    if (missing(error)) throw new HttpError(404, `Запись корзины больше не найдена: ${id}`);
    throw error;
  });
  return { full, info };
}

/** Creates the original parents, refusing symlinked or non-folder path components. */
async function restoreParent(base: string, parent: string) {
  let current = base;
  for (const part of parent.split("/").filter(Boolean)) {
    if (part === "." || part === "..") throw new HttpError(403, "Некорректный путь восстановления");
    const next = resolve(current, part);
    const info = await lstat(next).catch((error: NodeJS.ErrnoException) => {
      if (missing(error)) return undefined;
      throw error;
    });
    if (!info) {
      await mkdir(next, { mode: 0o755 });
      current = next;
      continue;
    }
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new HttpError(409, `Папка «${part}» недоступна для восстановления`);
    current = next;
  }
  return current;
}

async function restoreEntry(base: string, trash: string, id: string): Promise<TrashRestore> {
  const { full } = await existingEntry(trash, id);
  const record = await readTrashRecord(trash, id);
  const relative = record?.path ?? trashEntryName(id);
  validatePath(relative);
  if (!recordedPath(relative) || (await pathExcluded(relative)))
    throw new HttpError(403, "Восстановление в этот путь запрещено");
  const parent = await restoreParent(base, parentPath(relative));
  const name = relative.split("/").at(-1)!;
  for (let index = 1; index <= 1000; index++) {
    const candidate = index === 1 ? name : restoredName(name, index);
    await os.tools.moveNoReplace(full, resolve(parent, candidate));
    // `mv --update=none` reports success even when the destination already exists.
    if (!(await exists(full))) {
      await forgetTrashEntry(trash, id);
      const directory = parentPath(relative);
      return { id, path: directory ? `${directory}/${candidate}` : candidate };
    }
  }
  throw new HttpError(409, "Не удалось подобрать свободное имя для восстановления");
}

/** Moves entries back to their old paths; a taken name gets `(2)` instead of overwriting. */
export async function restoreProjectTrash(root: string, ids: string[]): Promise<TrashMutation> {
  const found = await trashRoot(root);
  if (!found) throw new HttpError(404, "Корзина пуста");
  const restored: TrashRestore[] = [];
  for (const id of new Set(ids)) restored.push(await restoreEntry(found.base, found.trash, id));
  return { restored, entries: await trashEntries(found.trash) };
}

/** Erases selected entries for good. */
export async function deleteProjectTrash(root: string, ids: string[]): Promise<TrashMutation> {
  const found = await trashRoot(root);
  if (!found) throw new HttpError(404, "Корзина пуста");
  for (const id of new Set(ids)) {
    const { full } = await existingEntry(found.trash, id);
    await rm(full, { recursive: true, force: true });
    await forgetTrashEntry(found.trash, id);
  }
  return { restored: [], entries: await trashEntries(found.trash) };
}

/** Removes the whole trash folder, including metadata and leftover temporary files. */
export async function emptyProjectTrash(root: string): Promise<TrashMutation> {
  const found = await trashRoot(root);
  if (!found) return { restored: [], entries: [] };
  await rm(found.trash, { recursive: true, force: true });
  return { restored: [], entries: [] };
}
