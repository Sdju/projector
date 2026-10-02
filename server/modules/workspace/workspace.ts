import { execFile } from "node:child_process";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { HttpError } from "../http/index.ts";
import { moveDestination } from "../../../core/modules/workspace/index.ts";
import type {
  FileComparison,
  GitOverview,
  SearchHit,
} from "../../../core/modules/workspace/index.ts";

const exec = promisify(execFile);
const MAX_BYTES = 1024 * 1024;
const excluded = new Set([
  ".git",
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
export async function listProjectDirectory(root: string, path = "") {
  const full = await location(root, path);
  const entries = (await readdir(full, { withFileTypes: true }))
    .filter((entry) => !excluded.has(entry.name) && (entry.isDirectory() || entry.isFile()))
    .sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
    );
  return {
    entries: entries.slice(0, 1000).map((entry) => ({
      name: entry.name,
      path: path ? `${path}/${entry.name}` : entry.name,
      directory: entry.isDirectory(),
    })),
    truncated: entries.length > 1000,
  };
}
export async function moveProjectEntry(root: string, path: string, directory: string) {
  // Mutations only accept canonical visible tree entries, never symlink aliases.
  for (const value of [path, directory]) {
    validatePath(value);
    if (value && value.split("/").some((part) => !part || part === "." || excluded.has(part)))
      throw new HttpError(403, "Перенос доступен только для файлов дерева проекта");
    if (value.includes("\\")) throw new HttpError(403, "Некорректный путь");
  }
  const destination = moveDestination(path, directory);
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
    await exec("mv", ["--no-clobber", "--no-target-directory", "--no-copy", "--", source, target]);
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
export async function searchProject(root: string, query: string) {
  if (!query.trim()) return { hits: [], truncated: false };
  if (query.length > 200) throw new HttpError(400, "Запрос длиннее 200 символов");
  const base = await realpath(root);
  let output: string;
  try {
    const result = await exec(
      "rg",
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
    changes.push({
      path: path.slice(prefix.length),
      originalPath: original?.startsWith(prefix) ? original.slice(prefix.length) : undefined,
      index: row[0],
      worktree: row[1],
    });
  }
  return { available: true, branch, changes };
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
