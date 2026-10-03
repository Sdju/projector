import { os } from "../../../core/modules/os/index.ts";
import { execFile } from "node:child_process";
import { lstat, open, readdir, realpath, rename, unlink, mkdir, cp, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { HttpError } from "../http/index.ts";
import { moveDestination } from "../../../core/modules/workspace/index.ts";
import type {
  FileComparison,
  GitGutter,
  GitOverview,
  SearchHit,
  FileContent,
  ArchiveContent,
} from "../../../core/modules/workspace/index.ts";

const exec = promisify(execFile);
const MAX_BYTES = 1024 * 1024;
const archiveHelper = fileURLToPath(new URL("./archive.py", import.meta.url));
const excluded = new Set([
  ".git",
  ".projector-trash",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  ".cache",
  ".venv",
  "vendor",
]);
function within(root: string, path: string) {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function validatePath(path: string) {
  if (isAbsolute(path) || path.split(/[\\/]/).includes("..") || path.includes("\0"))
    throw new HttpError(403, "Путь должен находиться внутри проекта");
}
async function location(root: string, path: string) {
  validatePath(path);
  const base = await realpath(root);
  const full = await realpath(resolve(base, path));
  if (!within(base, full)) throw new HttpError(403, "Путь выходит за пределы проекта");
  return full;
}
function decode(buffer: Buffer) {
  if (buffer.includes(0)) throw new HttpError(415, "Бинарный файл — просмотр текста недоступен");
  return buffer.toString("utf8");
}
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
  if (
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || excluded.has(part))
  )
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
export async function previewProjectFile(root: string, path: string): Promise<FileContent & { image?: boolean }> {
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
    throw new HttpError(413, "Архив слишком большой или превышено время просмотра");
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
export async function listProjectDirectory(root: string, path = "") {
  const full = await location(root, path);
  const entries = (await readdir(full, { withFileTypes: true }))
    .filter((entry) => !excluded.has(entry.name) && (entry.isDirectory() || entry.isFile()))
    .sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
    );
  return {
    entries: await Promise.all(
      entries.slice(0, 1000).map(async (entry) => ({
        name: entry.name,
        path: path ? `${path}/${entry.name}` : entry.name,
        directory: entry.isDirectory(),
        executable:
          entry.isFile() &&
          (await lstat(resolve(full, entry.name)).then(
            (info) => info.isFile() && !!(info.mode & 0o111),
            () => false,
          )),
      })),
    ),
    truncated: entries.length > 1000,
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
    if (value && value.split("/").some((part) => !part || part === "." || excluded.has(part)))
      throw new HttpError(403, "Перенос доступен только для файлов дерева проекта");
    if (value.includes("\\")) throw new HttpError(403, "Некорректный путь");
  }
  if (name !== undefined) validateEntryName(name);
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
function validateEntryName(name: string) {
  if (!name.trim() || name === "." || name === ".." || /[/\\\0]/.test(name) || excluded.has(name))
    throw new HttpError(400, "Укажите имя без разделителей пути");
}
async function mutationLocation(root: string, path: string, allowRoot = false) {
  validatePath(path);
  if (
    (!path && !allowRoot) ||
    path.includes("\\") ||
    (path && path.split("/").some((part) => !part || part === "." || excluded.has(part)))
  )
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
    validateEntryName(name);
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
  validateEntryName(name);
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
export async function searchProject(root: string, query: string) {
  if (!query.trim()) return { hits: [], truncated: false };
  if (query.length > 200) throw new HttpError(400, "Запрос длиннее 200 символов");
  const base = await realpath(root);
  let output: string;
  try {
    const result = await os.tools.searchFiles(
      [
        "--json",
        "--hidden",
        "--no-require-git",
        "--fixed-strings",
        "--ignore-case",
        "--max-count",
        "5",
        "--max-filesize",
        "1M",
        ...[...excluded].flatMap((name) => ["--glob", `!${name}/**`]),
        "--",
        query,
        ".",
      ],
      { cwd: base, maxBuffer: 4 * MAX_BYTES, timeout: 10000 },
    );
    output = result.stdout;
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string };
    if (failure.code === 1) return { hits: [], truncated: false };
    if (failure.code === "ENOENT") throw new HttpError(503, "Для поиска нужен ripgrep (rg)");
    throw new HttpError(400, "Поиск слишком большой или недоступен. Уточните запрос.");
  }
  const hits: SearchHit[] = [];
  for (const row of output.split("\n")) {
    if (!row) continue;
    const event = JSON.parse(row);
    if (event.type !== "match" || !event.data.path.text || !event.data.lines.text) continue;
    const data = event.data;
    hits.push({
      path: data.path.text.replace(/^\.\//, ""),
      line: data.line_number,
      column:
        Buffer.from(data.lines.text).subarray(0, data.submatches[0].start).toString("utf8").length +
        1,
      text: data.lines.text.trimEnd().slice(0, 500),
    });
    if (hits.length > 200) break;
  }
  return { hits: hits.slice(0, 200), truncated: hits.length > 200 };
}
async function git(root: string, args: string[]) {
  return (
    await exec("git", ["--literal-pathspecs", "-C", root, ...args], {
      maxBuffer: 4 * MAX_BYTES,
      timeout: 10000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    })
  ).stdout;
}
export async function projectGit(root: string): Promise<GitOverview> {
  try {
    await git(root, ["rev-parse", "--show-toplevel"]);
  } catch {
    return { available: false, branch: "", changes: [] };
  }
  const prefix = (await git(root, ["rev-parse", "--show-prefix"])).trim();
  const branch = (
    await git(root, ["symbolic-ref", "--short", "HEAD"]).catch(() =>
      git(root, ["rev-parse", "--short", "HEAD"]),
    )
  ).trim();
  const rows = (
    await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."])
  ).split("\0");
  const changes: GitOverview["changes"] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const path = row.slice(3);
    const rename = /[RC]/.test(row.slice(0, 2));
    const original = rename ? rows[++i] : undefined;
    if (!path.startsWith(prefix)) continue;
    if (path.slice(prefix.length).split("/").includes(".projector-trash")) continue;
    changes.push({
      path: path.slice(prefix.length),
      originalPath: original?.startsWith(prefix) ? original.slice(prefix.length) : undefined,
      index: row[0],
      worktree: row[1],
    });
  }
  await Promise.all(
    changes.map(async (change) => {
      change.executable = await location(root, change.path)
        .then((full) => lstat(full).then((info) => info.isFile() && !!(info.mode & 0o111)))
        .catch(() => false);
    }),
  );
  return { available: true, branch, changes };
}
// Serialize index writes even when multiple SDK clients act at once.
const pendingGitWrites = new Map<string, Promise<GitOverview>>();
export async function mutateProjectGit(
  root: string,
  action: string,
  selection: string | string[],
): Promise<GitOverview> {
  if (!["stage", "unstage", "discard"].includes(action))
    throw new HttpError(400, "Неизвестное действие Git");
  const paths = [...new Set(Array.isArray(selection) ? selection : [selection])];
  if (!paths.length || paths.length > 10000 || (action === "discard" && paths.length !== 1))
    throw new HttpError(400, "Укажите файлы Git");
  for (const path of paths) {
    validatePath(path);
    if (
      !path ||
      path.includes("\\") ||
      path.split("/").some((part) => !part || part === "." || excluded.has(part))
    )
      throw new HttpError(403, "Выберите файл проекта");
  }
  const base = await realpath(root);
  const repository = (await git(base, ["rev-parse", "--absolute-git-dir"])).trim();
  const previous = pendingGitWrites.get(repository);
  const operation = (async () => {
    await previous?.catch(() => {});
    const overview = await projectGit(base);
    const selected = paths.map((path) => {
      const change = overview.changes.find((entry) => entry.path === path);
      if (!change) throw new HttpError(404, "Изменение больше не найдено. Обновите Git.");
      return change;
    });
    const indexPaths = new Set(paths);
    // Validate the entire selection before changing the shared index.
    for (const change of selected) {
      let ancestor = change.path;
      while (ancestor) {
        try {
          await mutationLocation(base, ancestor);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          ancestor = ancestor.split("/").slice(0, -1).join("/");
        }
      }
      const conflict =
        change.index === "U" ||
        change.worktree === "U" ||
        ["AA", "DD"].includes(change.index + change.worktree);
      if (action !== "stage" && conflict)
        throw new HttpError(409, "Сначала разрешите конфликт слияния");
      if (action === "unstage") {
        if ([" ", "?"].includes(change.index)) throw new HttpError(409, "Нет изменений Staged");
        if (change.index === "R") {
          if (!change.originalPath)
            throw new HttpError(
              409,
              "Переименование пересекает границу проекта. Откройте корень репозитория.",
            );
          validatePath(change.originalPath);
          if (change.originalPath.split("/").some((part) => excluded.has(part)))
            throw new HttpError(403, "Недоступный путь Git");
          indexPaths.add(change.originalPath);
        }
      } else if (change.worktree === " ") throw new HttpError(409, "Нет рабочих изменений");
    }
    if (action === "stage") await git(base, ["add", "--", ...paths]);
    else if (action === "unstage") {
      const hasHead = await git(base, ["rev-parse", "--verify", "HEAD"]).then(
        () => true,
        () => false,
      );
      await git(
        base,
        hasHead
          ? ["restore", "--staged", "--", ...indexPaths]
          : ["rm", "--cached", "-f", "--", ...indexPaths],
      );
    } else if (selected[0]!.index === "?") await mutateProjectEntry(base, "delete", paths[0]!);
    else await git(base, ["restore", "--worktree", "--", paths[0]!]);
    return projectGit(base);
  })();
  pendingGitWrites.set(repository, operation);
  try {
    return await operation;
  } finally {
    if (pendingGitWrites.get(repository) === operation) pendingGitWrites.delete(repository);
  }
}
async function gitText(root: string, ref: string, path: string) {
  validatePath(path);
  const prefix = (await git(root, ["rev-parse", "--show-prefix"])).trim();
  const value = await git(root, ["show", `${ref}:${prefix}${path}`]);
  if (Buffer.byteLength(value) > MAX_BYTES) throw new HttpError(413, "Файл больше 1 МБ");
  return decode(Buffer.from(value));
}
export async function projectComparison(
  root: string,
  path: string,
  staged: boolean,
): Promise<FileComparison> {
  validatePath(path);
  const overview = await projectGit(root);
  const change = overview.changes.find((item) => item.path === path);
  if (!change) throw new HttpError(404, "Изменение больше не найдено. Обновите Git.");
  if (
    change.index === "U" ||
    change.worktree === "U" ||
    ["AA", "DD"].includes(change.index + change.worktree)
  )
    throw new HttpError(
      409,
      "Конфликт слияния. Откройте файл в дереве, чтобы просмотреть маркеры конфликта.",
    );
  const status = staged ? change.index : change.worktree;
  if (status === " ") throw new HttpError(404, "Изменение больше не найдено");
  const untracked = change.index === "?";
  const originalPath = staged ? (change.originalPath ?? path) : path;
  const original =
    untracked || status === "A" ? "" : await gitText(root, staged ? "HEAD" : "", originalPath);
  const modified =
    status === "D"
      ? ""
      : staged
        ? await gitText(root, "", path)
        : (await readProjectFile(root, path)).content;
  return { path, original, modified, staged };
}
/**
 * Index version of a tracked file for editor gutter decorations. Like VS Code,
 * staged changes are not marked and untracked files have no gutter.
 */
export async function projectGutter(root: string, path: string): Promise<GitGutter> {
  validatePath(path);
  const unavailable: GitGutter = { available: false, original: "" };
  try {
    await git(root, ["rev-parse", "--show-toplevel"]);
    await git(root, ["ls-files", "--error-unmatch", "--", path]);
    return { available: true, original: await git(root, ["show", `:./${path}`]) };
  } catch {
    return unavailable;
  }
}
