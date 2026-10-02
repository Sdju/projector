import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { HttpError } from "../http/index.ts";

export async function resolveTerminalPath(path: string, projectRoot: string, cwd: string) {
  if (!path || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path))
    throw new HttpError(400, "Некорректный путь к файлу");
  const expanded = path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path;
  const candidates = isAbsolute(expanded)
    ? [expanded]
    : [resolve(cwd, expanded), resolve(projectRoot, expanded)];
  const root = await realpath(projectRoot);
  for (const candidate of new Set(candidates)) {
    try {
      const full = await realpath(candidate);
      if (!(await stat(full)).isFile()) continue;
      const local = relative(root, full);
      const external = local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local);
      return { path: external ? full : local, external };
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? ""))
        throw error;
    }
  }
  throw new HttpError(404, "Файл из терминала не найден");
}
