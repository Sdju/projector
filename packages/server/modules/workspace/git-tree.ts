import { HttpError } from "../http/index.ts";
import {
  LARGE_FILE_BYTES,
  MAX_TEXT_BYTES,
  isExcludedPath,
  treePageRange,
  type FileContent,
  type FileEntry,
  type TreePage,
} from "@projector-ai/core/modules/workspace/index.ts";
import { git, gitBytes, gitText } from "./git.ts";
import { excludePatterns } from "./files-exclude.ts";
import { imageType, isRasterImage } from "./files.ts";
import { MAX_BYTES, validatePath } from "./paths.ts";

const COMMIT = /^[0-9a-f]{7,40}$/i;

export async function resolveRevision(root: string, rev: string) {
  if (!COMMIT.test(rev)) throw new HttpError(400, "Некорректный хеш коммита");
  const full = (
    await git(root, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]).catch(() => "")
  ).trim();
  if (!full) throw new HttpError(404, "Коммит не найден");
  return full;
}

export function validateRelativePath(path: string) {
  validatePath(path);
  if (path.includes("\\")) throw new HttpError(403, "Некорректный путь");
}

/**
 * Directory of a committed tree. Git names entries relative to the project folder, so the same
 * paging and exclusion contract as the working tree applies; only the source of the listing differs.
 */
export async function listProjectGitTree(
  root: string,
  rev: string,
  path = "",
  params: Record<string, string> = {},
): Promise<TreePage> {
  const commit = await resolveRevision(root, rev);
  validateRelativePath(path);
  const args = ["ls-tree", "-z", commit];
  // A trailing slash asks git for the contents of the directory, not the directory entry itself.
  if (path) args.push("--", `${path}/`);
  const raw = await git(root, args);
  const patterns = await excludePatterns();
  const entries: FileEntry[] = [];
  for (const row of raw.split("\0")) {
    if (!row) continue;
    const tab = row.indexOf("\t");
    if (tab < 0) continue;
    const [mode = "", type = ""] = row.slice(0, tab).split(" ");
    const entryPath = row.slice(tab + 1);
    if (!entryPath || isExcludedPath(entryPath, patterns)) continue;
    const name = entryPath.split("/").at(-1);
    if (!name) continue;
    entries.push({
      name,
      path: entryPath,
      directory: type === "tree",
      ...(mode === "100755" ? { executable: true } : {}),
      ...(type === "commit" ? { disabled: true } : {}),
    });
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  let page;
  try {
    page = treePageRange(entries, path, params);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Неверная страница");
  }
  return {
    entries: entries.slice(page.offset, page.end),
    truncated: page.nextOffset !== null,
    total: page.total,
    nextOffset: page.nextOffset,
  };
}

/** Text of a committed file; the answer is always read-only. */
/** Raw image bytes of a committed file; raster images are shown by URL, SVG is read as text. */
export async function readProjectGitImage(root: string, rev: string, path: string) {
  validateRelativePath(path);
  const type = imageType(path);
  if (!type) throw new HttpError(415, "Поддерживаются только изображения");
  const commit = await resolveRevision(root, rev);
  const prefix = (await git(root, ["rev-parse", "--show-prefix"])).trim();
  const spec = `${commit}:${prefix}${path}`;
  const kind = (await git(root, ["cat-file", "-t", spec]).catch(() => "")).trim();
  if (kind !== "blob") throw new HttpError(404, "Изображение не найдено в этом коммите");
  const size = Number((await git(root, ["cat-file", "-s", spec])).trim());
  const limit = 8 * MAX_BYTES;
  if (!Number.isSafeInteger(size) || size < 0)
    throw new HttpError(404, "Изображение не найдено в этом коммите");
  if (size > limit) throw new HttpError(413, "Изображение больше 8 МБ");
  return { type, content: await gitBytes(root, ["show", spec], limit + 1) };
}

export async function readProjectGitFile(
  root: string,
  rev: string,
  path: string,
  options: { ask?: boolean } = {},
): Promise<FileContent & { image?: boolean }> {
  const commit = await resolveRevision(root, rev);
  validateRelativePath(path);
  if (!path) throw new HttpError(400, "Выберите файл");
  const prefix = (await git(root, ["rev-parse", "--show-prefix"])).trim();
  const spec = `${commit}:${prefix}${path}`;
  const type = (await git(root, ["cat-file", "-t", spec]).catch(() => "")).trim();
  if (!type) throw new HttpError(404, "Файл не найден в этом коммите");
  if (type !== "blob") throw new HttpError(400, "Выберите файл");
  const size = Number((await git(root, ["cat-file", "-s", spec])).trim());
  if (!Number.isSafeInteger(size) || size < 0)
    throw new HttpError(404, "Файл не найден в этом коммите");
  if (isRasterImage(path)) {
    if (size > 8 * MAX_BYTES) throw new HttpError(413, "Изображение больше 8 МБ");
    return { path, content: "", image: true, readonly: true, size };
  }
  if (size > MAX_TEXT_BYTES)
    throw new HttpError(
      413,
      `Файл больше ${MAX_TEXT_BYTES / 1024 / 1024} МБ: редактор не сможет его открыть`,
    );
  if (options.ask && size >= LARGE_FILE_BYTES)
    return { path, content: "", large: size, readonly: true };
  try {
    return { path, content: await gitText(root, commit, path), readonly: true, size };
  } catch (error) {
    if (error instanceof HttpError && error.status === 415)
      return { path, content: "", binary: true, size, readonly: true };
    if (error instanceof HttpError) throw error;
    throw new HttpError(404, "Файл не найден в этом коммите");
  }
}
