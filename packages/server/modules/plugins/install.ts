import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import type { PluginManifest } from "@ai-projector/core/modules/plugins/index.ts";

/** Destination of a managed install: `packages/<name>/<version>`, never outside that root. */
export function destinationFor(manifest: PluginManifest, packages: string): string {
  const destination = resolve(packages, ...manifest.name.split("/"), manifest.version);
  if (!destination.startsWith(`${resolve(packages)}${sep}`))
    throw new Error("Небезопасный путь установки");
  return destination;
}

async function hasSymlink(dir: string): Promise<boolean> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) return true;
    if (entry.isDirectory() && (await hasSymlink(join(dir, entry.name)))) return true;
  }
  return false;
}

/** Copies only regular files and folders; symlinks and special files are rejected. */
export async function copyPackage(source: string, destination: string): Promise<void> {
  const stats = await lstat(source);
  if (stats.isSymbolicLink()) throw new Error("Символические ссылки в плагинах не поддерживаются");
  if (stats.isDirectory()) {
    // pnpm's workspace node_modules is a forest of links; skip it so trust can install clean deps.
    if (basename(source) === "node_modules" && (await hasSymlink(source))) return;
    await mkdir(destination);
    for (const entry of await readdir(source))
      await copyPackage(join(source, entry), join(destination, entry));
    return;
  }
  if (!stats.isFile()) throw new Error("Плагин может содержать только обычные файлы и папки");
  await writeFile(destination, await readFile(source), { flag: "wx" });
}
