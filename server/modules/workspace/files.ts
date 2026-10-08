import { os } from "../../../core/modules/os/index.ts";
import { lstat, open, readdir, realpath, rename, unlink, mkdir, cp, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { HttpError } from "../http/index.ts";
import { moveDestination, treePageRange } from "../../../core/modules/workspace/index.ts";
import { ignoredPaths } from "./ignored.ts";
import {
  MAX_BYTES,
  decode,
  excludePatterns,
  location,
  nameExcluded,
  pathExcluded,
  validatePath,
} from "./paths.ts";
import { isExcludedPath } from "../../../core/modules/workspace/index.ts";

const archiveHelper = fileURLToPath(new URL("./archive.py", import.meta.url));
import type { FileContent, ArchiveContent } from "../../../core/modules/workspace/index.ts";

export async function readProjectFile(root: string, path: string) {
  const full = await location(root, path);
  const file = await open(full, "r");
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new HttpError(400, "Выберите файл");
    if (info.size > MAX_BYTES) throw new HttpError(413, "Файл больше 1 МБ");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_BYTES) throw new HttpError(413, "Файл больше 1 МБ");
    return { path, content: decode(buffer.subarray(0, bytesRead)) };
  } finally {
    await file.close();
  }
}
const pendingWrites = new Map<string, Promise<unknown>>();
export async function saveProjectFile(
  root: string,
  path: string,
  content: string,
  original: string,
) {
  validatePath(path);
  if (path.includes("\\") || (await pathExcluded(path)))
    throw new HttpError(403, "Выберите файл дерева проекта");
  if (Buffer.byteLength(content) > MAX_BYTES || Buffer.byteLength(original) > MAX_BYTES)
    throw new HttpError(413, "Файл больше 1 МБ");
  if (content.includes("\0"))
    throw new HttpError(415, "Бинарный файл недоступен для редактирования");
  const base = await realpath(root);
  const full = await location(base, path);
  if (full !== resolve(base, path))
    throw new HttpError(403, "Запись через символические ссылки недоступна");
  const previous = pendingWrites.get(full);
  const write = (async () => {
    await previous?.catch(() => {});
    if ((await readProjectFile(base, path)).content !== original)
      throw new HttpError(
        409,
        "Файл изменён на диске. Откройте его заново после сохранения копии черновика.",
      );
    const info = await lstat(full);
    if (!info.isFile() || info.nlink > 1)
      throw new HttpError(403, "Запись связанного файла недоступна");
    const temporary = resolve(dirname(full), `.projector-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx", info.mode & 0o777);
      try {
        await file.writeFile(content, "utf8");
        await file.chmod(info.mode & 0o777);
        await file.sync();
      } finally {
        await file.close();
      }
      if (
        (await location(base, path)) !== full ||
        (await readProjectFile(base, path)).content !== original
      )
        throw new HttpError(409, "Файл изменён на диске. Черновик не сохранён.");
      await rename(temporary, full);
      return { path, content };
    } finally {
      await unlink(temporary).catch(() => {});
    }
  })();
  pendingWrites.set(full, write);
  try {
    return await write;
  } finally {
    if (pendingWrites.get(full) === write) pendingWrites.delete(full);
  }
}
export async function previewProjectFile(
  root: string,
  path: string,
): Promise<FileContent & { image?: boolean }> {
  if (/\.(?:png|jpe?g|gif|webp|avif)$/i.test(path)) {
    await readProjectImage(root, path);
    return { path, content: "", image: true };
  }
  if (!/\.(?:tar|tgz|gz|gzip|bz2|tbz2?|xz|txz|zip)$/i.test(path))
    return readProjectFile(root, path);
  const full = await location(root, path);
  const info = await lstat(full);
  if (!info.isFile()) throw new HttpError(400, "Выберите файл");
  let stdout: string;
  try {
    ({ stdout } = await os.tools.runPython(archiveHelper, [full, path], {
      timeout: 15000,
      maxBuffer: 8 * MAX_BYTES,
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new HttpError(503, "Для просмотра архивов нужен Python 3");
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
    if (failure.killed || failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      throw new HttpError(413, "Архив слишком большой или превышено время просмотра");
    throw new HttpError(
      422,
      `Не удалось прочитать архив: ${(failure.stderr || failure.message).trim().split(/\r?\n/).at(-1)}`,
    );
  }
  const data = JSON.parse(stdout) as ArchiveContent & { error?: string; status?: number };
  if (data.error) throw new HttpError(data.status ?? 422, data.error);
  return { path, content: "", archive: data };
}
export async function readProjectImage(root: string, path: string) {
  const types: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    svg: "image/svg+xml",
  };
  const type = types[path.split(".").at(-1)?.toLowerCase() ?? ""];
  if (!type) throw new HttpError(415, "Поддерживаются только изображения");
  const file = await open(await location(root, path), "r");
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new HttpError(400, "Выберите файл");
    const limit = 8 * MAX_BYTES;
    if (info.size > limit) throw new HttpError(413, "Изображение больше 8 МБ");
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) throw new HttpError(413, "Изображение больше 8 МБ");
    return { type, content: buffer.subarray(0, bytesRead) };
  } finally {
    await file.close();
  }
}
export async function listProjectDirectory(
  root: string,
  path = "",
  params: Record<string, string> = {},
) {
  const full = await location(root, path);
  const patterns = await excludePatterns();
  const entries = (await readdir(full, { withFileTypes: true }))
    .filter((entry) => {
      if (!(entry.isDirectory() || entry.isFile())) return false;
      const relative = path ? `${path}/${entry.name}` : entry.name;
      return !isExcludedPath(relative, patterns);
    })
    .sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
    );
  let page;
  try {
    page = treePageRange(entries, path, params);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Неверная страница");
  }
  const visible = entries.slice(page.offset, page.end);
  const ignored = await ignoredPaths(
    full,
    visible.map((entry) => entry.name),
  );
  return {
    entries: await Promise.all(
      visible.map(async (entry) => ({
        name: entry.name,
        path: path ? `${path}/${entry.name}` : entry.name,
        directory: entry.isDirectory(),
        ...(ignored.has(entry.name) ? { ignored: true } : {}),
        executable:
          entry.isFile() &&
          (await lstat(resolve(full, entry.name)).then(
            (info) => info.isFile() && !!(info.mode & 0o111),
            () => false,
          )),
      })),
    ),
    truncated: page.nextOffset !== null,
    total: page.total,
    nextOffset: page.nextOffset,
  };
}
export async function moveProjectEntry(
  root: string,
  path: string,
  directory: string,
  name?: string,
) {
  // Mutations only accept canonical visible tree entries, never symlink aliases.
  for (const value of [path, directory]) {
    validatePath(value);
    if (value && (await pathExcluded(value)))
      throw new HttpError(403, "Перенос доступен только для файлов дерева проекта");
    if (value.includes("\\")) throw new HttpError(403, "Некорректный путь");
  }
  if (name !== undefined) await validateEntryName(name);
  const destination =
    name === undefined
      ? moveDestination(path, directory)
      : directory
        ? `${directory}/${name}`
        : name;
  if (destination && (destination === path || destination.startsWith(path + "/")))
    throw new HttpError(400, "Нельзя перенести в ту же папку или внутрь себя");
  if (!destination) throw new HttpError(400, "Нельзя перенести в ту же папку или внутрь себя");
  const base = await realpath(root);
  const source = await location(base, path);
  const targetDirectory = await location(base, directory);
  if (source !== resolve(base, path) || targetDirectory !== resolve(base, directory))
    throw new HttpError(403, "Перенос через символические ссылки недоступен");
  const info = await lstat(source);
  if (!info.isFile() && !info.isDirectory()) throw new HttpError(400, "Выберите файл или папку");
  if (!(await lstat(targetDirectory)).isDirectory())
    throw new HttpError(400, "Выберите папку назначения");
  const target = resolve(base, destination);
  const exists = async () =>
    lstat(target).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
  if (await exists()) throw new HttpError(409, "В папке назначения уже есть запись с таким именем");
  try {
    // GNU mv uses a no-replace rename, preventing overwrite even if a destination
    // appears after the check. No copy fallback: a failed move leaves the source intact.
    await os.tools.moveNoReplace(source, target);
  } catch (error) {
    if (await exists())
      throw new HttpError(409, "В папке назначения уже есть запись с таким именем");
    throw error;
  }
  const remains = await lstat(source).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  if (remains) throw new HttpError(409, "Не удалось перенести: запись назначения уже существует");
  return { source: path, destination };
}
export async function validateEntryName(name: string) {
  if (
    !name.trim() ||
    name === "." ||
    name === ".." ||
    /[/\\\0]/.test(name) ||
    (await nameExcluded(name))
  )
    throw new HttpError(400, "Укажите имя без разделителей пути");
}
export async function mutationLocation(root: string, path: string, allowRoot = false) {
  validatePath(path);
  if ((!path && !allowRoot) || path.includes("\\") || (path && (await pathExcluded(path))))
    throw new HttpError(403, "Выберите запись дерева проекта");
  const base = await realpath(root);
  const full = await location(base, path);
  if (full !== resolve(base, path))
    throw new HttpError(403, "Операции через символические ссылки недоступны");
  return full;
}
export async function mutateProjectEntry(
  root: string,
  action: string,
  path: string,
  directory = "",
  name = "",
) {
  if (action === "rename") {
    await validateEntryName(name);
    await mutationLocation(root, path);
    return moveProjectEntry(root, path, path.split("/").slice(0, -1).join("/"), name);
  }
  if (action === "delete") {
    const source = await mutationLocation(root, path);
    // Keep deleted entries on disk so accidental deletion is recoverable.
    const base = await realpath(root);
    const trash = resolve(base, ".projector-trash");
    await mkdir(trash, { recursive: true, mode: 0o700 });
    if ((await realpath(trash)) !== trash) throw new HttpError(403, "Некорректная папка корзины");
    await rename(source, resolve(trash, `${randomUUID()}-${path.split("/").at(-1)}`));
    return { source: path };
  }
  if (!["create-file", "create-directory", "copy"].includes(action))
    throw new HttpError(400, "Неизвестное действие");
  await validateEntryName(name);
  const parent = await mutationLocation(root, directory, true);
  if (!(await lstat(parent)).isDirectory()) throw new HttpError(400, "Выберите папку назначения");
  const destination = directory ? `${directory}/${name}` : name;
  const target = resolve(parent, name);
  try {
    if (action === "create-file") {
      const file = await open(target, "wx");
      await file.close();
    } else if (action === "create-directory") await mkdir(target);
    else {
      const source = await mutationLocation(root, path);
      if (destination === path || destination.startsWith(path + "/"))
        throw new HttpError(400, "Нельзя копировать запись внутрь себя");
      // Stage the complete copy before publishing; never overwrite a destination.
      const temporary = resolve(parent, `.projector-${randomUUID()}.tmp`);
      try {
        await cp(source, temporary, {
          recursive: true,
          dereference: false,
          verbatimSymlinks: true,
          force: false,
          errorOnExist: true,
        });
        await os.tools.moveNoReplace(temporary, target);
        if (
          await lstat(temporary).then(
            () => true,
            () => false,
          )
        )
          throw new HttpError(409, "Запись с таким именем уже существует");
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new HttpError(409, "Запись с таким именем уже существует");
    throw error;
  }
  return { destination };
}
