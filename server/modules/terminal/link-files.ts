import { realpath, stat } from "node:fs/promises";
import { os } from "../../../core/modules/os/index.ts";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { HttpError } from "../http/index.ts";

export async function resolveTerminalPath(path: string, projectRoot: string, cwd: string) {
  if (!path || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path))
    throw new HttpError(400, "Некорректный путь к файлу");
  const expanded = path.startsWith("~/") ? resolve(os.homeDirectory(), path.slice(2)) : path;
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
      return { path: external ? full : local.split(sep).join("/"), external };
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? ""))
        throw error;
    }
  }
  throw new HttpError(404, "Файл из терминала не найден");
}

/**
 * Maps a path printed inside a Dev Container to the project on the host.
 * Anything that does not stay inside the mounted workspace cannot be opened.
 */
export function containerToHost(path: string, workspace: string, root: string) {
  const inside = path === workspace || path.startsWith(`${workspace}/`);
  if (!inside && (path.startsWith("/") || path.startsWith("~")))
    throw new HttpError(404, "Путь находится вне проекта внутри контейнера");
  const local = normalize(inside ? path.slice(workspace.length + 1) || "." : path);
  if (local === ".." || local.startsWith(`..${sep}`))
    throw new HttpError(404, "Путь выходит за пределы проекта");
  return join(root, local);
}
