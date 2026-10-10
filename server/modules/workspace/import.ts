import { createWriteStream } from "node:fs";
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import { cp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, isAbsolute, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { os } from "../../../core/modules/os/index.ts";
import { HttpError } from "../http/index.ts";
import { mutationLocation, trashProjectEntry, validateEntryName } from "./files.ts";

/** Один загруженный из браузера файл не больше этого размера. */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );

async function targetDirectory(root: string, directory: string) {
  const parent = await mutationLocation(root, directory, true);
  if (!(await lstat(parent)).isDirectory()) throw new HttpError(400, "Выберите папку назначения");
  return parent;
}

/** `name (2).ext`, `name (3).ext`… — первое свободное имя рядом с занятым. */
async function freeName(parent: string, name: string, taken: Set<string>) {
  const dot = name.lastIndexOf(".");
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let index = 2; ; index++) {
    const candidate = `${stem} (${index})${extension}`;
    if (!taken.has(candidate) && !(await exists(resolve(parent, candidate)))) return candidate;
  }
}

/** Какие из имён уже заняты в папке назначения и под каким именем их можно оставить рядом. */
export async function checkImportNames(root: string, directory: string, names: string[]) {
  const parent = await targetDirectory(root, directory);
  const taken = new Set(names);
  const conflicts: { name: string; free: string }[] = [];
  for (const name of names) {
    await validateEntryName(name);
    if (!(await exists(resolve(parent, name)))) continue;
    const free = await freeName(parent, name, taken);
    taken.add(free);
    conflicts.push({ name, free });
  }
  return { conflicts };
}

/** Освобождает имена: занятые записи уходят в `.projector-trash`, как при удалении. */
export async function clearImportNames(root: string, directory: string, names: string[]) {
  const parent = await targetDirectory(root, directory);
  for (const name of names) {
    await validateEntryName(name);
    if (await exists(resolve(parent, name)))
      await trashProjectEntry(root, directory ? `${directory}/${name}` : name);
  }
}

/**
 * Копирует записи с диска в папку проекта под заданными именами. Источник не меняется,
 * существующие записи не перезаписываются: занятое имя — 409 до начала копирования.
 */
export async function importProjectEntries(
  root: string,
  directory: string,
  entries: { source: string; name: string }[],
) {
  const parent = await targetDirectory(root, directory);
  const realParent = await realpath(parent);
  const names = new Set<string>();
  const sources: { source: string; name: string }[] = [];
  for (const { source, name } of entries) {
    if (!isAbsolute(source) || source.includes("\0"))
      throw new HttpError(400, "Укажите абсолютный путь к файлу");
    await validateEntryName(name);
    if (names.has(name)) throw new HttpError(409, `Имя «${name}» повторяется`);
    names.add(name);
    // Ссылка верхнего уровня копируется как её содержимое, ссылки внутри папок остаются ссылками.
    const real = await realpath(source).catch(() => {
      throw new HttpError(404, `Не найден: ${basename(source)}`);
    });
    const info = await lstat(real);
    if (!info.isFile() && !info.isDirectory())
      throw new HttpError(400, `Нельзя скопировать ${basename(source)}: это не файл и не папка`);
    if (realParent === real || realParent.startsWith(real + sep))
      throw new HttpError(400, "Нельзя копировать папку внутрь себя");
    if (await exists(resolve(parent, name)))
      throw new HttpError(409, `В папке назначения уже есть «${name}»`);
    sources.push({ source: real, name });
  }
  const copied: string[] = [];
  for (const { source, name } of sources) {
    const target = resolve(parent, name);
    const temporary = resolve(parent, `.projector-${randomUUID()}.tmp`);
    try {
      // Копия собирается целиком до публикации: оборванное копирование ничего не оставляет.
      await cp(source, temporary, {
        recursive: true,
        dereference: false,
        verbatimSymlinks: true,
        force: false,
        errorOnExist: true,
      });
      try {
        await os.tools.moveNoReplace(temporary, target);
      } catch (error) {
        if (!(await exists(target))) throw error;
      }
      if (await exists(temporary))
        throw new HttpError(409, `В папке назначения уже есть «${name}»`);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    copied.push(directory ? `${directory}/${name}` : name);
  }
  return { copied };
}

/** Создаёт недостающие папки вдоль относительного пути; ссылки и файлы на пути — ошибка. */
async function ensureDirectories(parent: string, parts: string[]) {
  let current = parent;
  for (const part of parts) {
    await validateEntryName(part);
    current = resolve(current, part);
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await lstat(current)).isDirectory())
        throw new HttpError(409, `«${part}» уже существует и не является папкой`);
    }
  }
  return current;
}

/**
 * Принимает один файл (или пустую папку) из браузера. `path` — относительный путь внутри
 * `directory`; файл пишется во временный файл и публикуется без перезаписи.
 */
export async function uploadProjectEntry(
  root: string,
  directory: string,
  path: string,
  body: Readable,
  options: { directory?: boolean; limit?: number } = {},
) {
  const parts = path.split("/");
  if (!path || parts.some((part) => !part) || path.includes("\\"))
    throw new HttpError(400, "Некорректный путь файла");
  const parent = await targetDirectory(root, directory);
  const name = parts.pop()!;
  await validateEntryName(name);
  const folder = await ensureDirectories(parent, parts);
  const destination = [directory, ...parts, name].filter(Boolean).join("/");
  const target = resolve(folder, name);
  if (options.directory) {
    body.resume();
    try {
      await mkdir(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await lstat(target)).isDirectory())
        throw new HttpError(409, `«${name}» уже существует и не является папкой`);
    }
    return { destination };
  }
  if (await exists(target)) {
    body.resume();
    throw new HttpError(409, `В папке назначения уже есть «${name}»`);
  }
  const limit = options.limit ?? MAX_UPLOAD_BYTES;
  const temporary = resolve(folder, `.projector-${randomUUID()}.tmp`);
  let size = 0;
  try {
    await pipeline(
      body,
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          size += chunk.length;
          done(
            size > limit ? new HttpError(413, "Файл слишком большой для загрузки") : null,
            chunk,
          );
        },
      }),
      createWriteStream(temporary, { flags: "wx", mode: 0o644 }),
    );
    try {
      await os.tools.moveNoReplace(temporary, target);
    } catch (error) {
      if (!(await exists(target))) throw error;
    }
    if (await exists(temporary)) throw new HttpError(409, `В папке назначения уже есть «${name}»`);
  } finally {
    await rm(temporary, { force: true });
  }
  return { destination };
}
