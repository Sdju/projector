import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { isSafePluginPath } from "@ai-projector/core/modules/plugins/index.ts";
import type { PluginAsset } from "./assets.ts";
import type { PluginInfo } from "./types.ts";

const readmeNames = ["README.md", "readme.md", "README.markdown", "readme.markdown"] as const;
const maxReadmeBytes = 1_000_000;
const docMime: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

async function findReadme(packagePath: string): Promise<string | undefined> {
  const root = resolve(packagePath);
  for (const name of readmeNames) {
    const file = resolve(root, name);
    if (file !== `${root}${sep}${name}`) continue;
    try {
      const stats = await lstat(file);
      if (
        stats.isFile() &&
        !stats.isSymbolicLink() &&
        stats.size > 0 &&
        stats.size <= maxReadmeBytes
      )
        return file;
    } catch {
      // The next conventional name may still exist.
    }
  }
}

/** True when the package root has a regular README the settings page can show. */
export async function pluginHasReadme(packagePath: string): Promise<boolean> {
  return !!(await findReadme(packagePath));
}

/** Markdown of the package README, or `null` when the file is missing or not a regular file. */
export async function readPluginReadme(plugin: PluginInfo | undefined): Promise<string | null> {
  if (!plugin?.path) return null;
  const file = await findReadme(plugin.path);
  if (!file) return null;
  const stats = await lstat(file);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maxReadmeBytes) return null;
  return readFile(file, "utf8");
}

/**
 * An image next to the README, confined to the package directory. SVG and HTML stay off the
 * origin: an untrusted package must not run script by way of its docs.
 */
export async function openPluginReadmeFile(
  plugin: PluginInfo | undefined,
  relative: string,
): Promise<PluginAsset | null> {
  if (!plugin?.path || !isSafePluginPath(relative)) return null;
  const root = resolve(plugin.path);
  const segments = relative.split("/");
  const target = resolve(root, ...segments);
  if (!target.startsWith(`${root}${sep}`)) return null;
  let current = root;
  for (const segment of ["", ...segments]) {
    if (segment) current = resolve(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch {
      return null;
    }
    if (stats.isSymbolicLink()) return null;
    if (segment === "" ? !stats.isDirectory() : segment !== segments.at(-1) && !stats.isDirectory())
      return null;
  }
  const type = docMime[extname(target).toLowerCase()];
  if (!type) return null;
  try {
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > maxReadmeBytes) {
      await handle.close();
      return null;
    }
    return { stream: handle.createReadStream(), size: stats.size, type };
  } catch {
    return null;
  }
}
