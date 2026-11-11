import { lstat, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  isPluginIconFile,
  sanitizePluginIconSvg,
} from "@ai-projector/core/modules/plugins/index.ts";

/** Reads a package-relative SVG and returns the sanitized markup the client mounts as the icon. */
export async function readPluginIcon(packagePath: string, relative: string): Promise<string> {
  if (!isPluginIconFile(relative)) throw new Error("Некорректная иконка агента");
  const path = resolve(packagePath, relative);
  if (!path.startsWith(`${resolve(packagePath)}${sep}`))
    throw new Error("Небезопасный путь к иконке агента");
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink())
    throw new Error("Иконка агента должна быть файлом");
  return sanitizePluginIconSvg(await readFile(path, "utf8"));
}
