import { environmentForPath, runEnvironmentCommand } from "../environments/index.ts";
import { lstat, realpath } from "node:fs/promises";
import { HttpError } from "../http/index.ts";
import { githubRepositoryFromRemote } from "../../../core/modules/github/index.ts";
import { MAX_BYTES, decode, exec, location, pathExcluded, validatePath } from "./paths.ts";
import { isExcludedPath } from "../../../core/modules/workspace/index.ts";
import { excludePatterns } from "./files-exclude.ts";
import { mutateProjectEntry, mutationLocation, readProjectFile } from "./files.ts";
import type {
  FileComparison,
  GitGutter,
  GitOverview,
} from "../../../core/modules/workspace/index.ts";

export async function git(root: string, args: string[]) {
  const project = await environmentForPath(root);
  if (project)
    return (
      await runEnvironmentCommand(
        project,
        [
          "/usr/bin/git",
          "--literal-pathspecs",
          "-c",
          "core.hooksPath=/dev/null",
          "-C",
          "/workspace",
          ...args,
        ],
        10_000,
      )
    ).stdout;
  return (
    await exec("git", ["--literal-pathspecs", "-C", root, ...args], {
      maxBuffer: 4 * MAX_BYTES,
      timeout: 10000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    })
  ).stdout;
}
/** `owner/repository` when the project's `origin` points at GitHub, otherwise null. */
export async function projectGithubRepository(root: string): Promise<string | null> {
  const remote = await git(root, ["remote", "get-url", "origin"]).catch(() => "");
  return githubRepositoryFromRemote(remote);
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
const pendingGitWrites = new Map<string, Promise<unknown>>();
/** Runs a write after the pending ones of the same repository finished. */
export async function serializeGitWrite<T>(root: string, write: () => Promise<T>): Promise<T> {
  const repository = (await git(root, ["rev-parse", "--absolute-git-dir"])).trim();
  const previous = pendingGitWrites.get(repository);
  const operation = (async () => {
    await previous?.catch(() => {});
    return write();
  })();
  pendingGitWrites.set(repository, operation);
  try {
    return await operation;
  } finally {
    if (pendingGitWrites.get(repository) === operation) pendingGitWrites.delete(repository);
  }
}
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
    if (!path || path.includes("\\") || (await pathExcluded(path)))
      throw new HttpError(403, "Выберите файл проекта");
  }
  const base = await realpath(root);
  return serializeGitWrite(base, async () => {
    const overview = await projectGit(base);
    const selected = paths.map((path) => {
      const change = overview.changes.find((entry) => entry.path === path);
      if (!change) throw new HttpError(404, "Изменение больше не найдено. Обновите Git.");
      return change;
    });
    const indexPaths = new Set(paths);
    const patterns = await excludePatterns();
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
          if (isExcludedPath(change.originalPath, patterns))
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
  });
}
export async function gitText(root: string, ref: string, path: string) {
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
