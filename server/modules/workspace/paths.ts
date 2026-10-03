import { execFile } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { HttpError } from "../http/index.ts";

export const exec = promisify(execFile);
export const MAX_BYTES = 1024 * 1024;
export const excluded = new Set([
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
export function within(root: string, path: string) {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
export function validatePath(path: string) {
  if (isAbsolute(path) || path.split(/[\\/]/).includes("..") || path.includes("\0"))
    throw new HttpError(403, "Путь должен находиться внутри проекта");
}
export async function location(root: string, path: string) {
  validatePath(path);
  const base = await realpath(root);
  const full = await realpath(resolve(base, path));
  if (!within(base, full)) throw new HttpError(403, "Путь выходит за пределы проекта");
  return full;
}
export function decode(buffer: Buffer) {
  if (buffer.includes(0)) throw new HttpError(415, "Бинарный файл — просмотр текста недоступен");
  return buffer.toString("utf8");
}
