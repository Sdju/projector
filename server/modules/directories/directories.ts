import { readdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { expandPath } from "../projects/index.ts";
import { HttpError } from "../http/index.ts";
import type { DirectoryListing } from "../../../core/modules/directories/index.ts";

export async function listDirectories(input: string, complete = false): Promise<DirectoryListing> {
  if (
    !input ||
    input.includes("\0") ||
    (!isAbsolute(input) && input !== "~" && !input.startsWith("~/"))
  )
    throw new HttpError(400, "Укажите абсолютный путь или ~/…");
  const expanded = expandPath(input);
  const contents = !complete || input.endsWith("/") || input === "~";
  const path = contents ? expanded : dirname(expanded);
  const prefix = contents ? "" : basename(expanded);
  try {
    const rows = (await readdir(path, { withFileTypes: true }))
      .filter((row) => row.name.startsWith(prefix))
      .sort((a, b) => a.name.localeCompare(b.name));
    const entries: DirectoryListing["entries"] = [];
    // Resolve directory symlinks as well; broken links simply aren't suggestions.
    for (const row of rows) {
      if (
        row.isDirectory() ||
        (row.isSymbolicLink() &&
          (await stat(join(path, row.name)).then(
            (info) => info.isDirectory(),
            () => false,
          )))
      )
        entries.push({ name: row.name, path: join(path, row.name) });
      if (entries.length > 1000) break;
    }
    return { path, entries: entries.slice(0, 1000), truncated: entries.length > 1000 };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new HttpError(
      code === "EACCES" || code === "EPERM" ? 403 : 400,
      code === "EACCES" || code === "EPERM" ? "Нет доступа к папке" : "Папка не найдена",
    );
  }
}
