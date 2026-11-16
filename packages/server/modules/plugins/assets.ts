import { constants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { isSafePluginPath } from "@ai-projector/core/modules/plugins/index.ts";
import type { PluginInfo } from "./types.ts";

/** Only files an ESM frontend can legitimately reference; HTML stays off the app origin. */
const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export interface PluginAsset {
  stream: ReturnType<FileHandle["createReadStream"]>;
  size: number;
  type: string;
}

/**
 * Resolves an asset of an enabled, trusted browser plugin with the exact current content hash.
 * The path is confined to the directory of the declared entry, every segment must be a real
 * directory/file (a symlink anywhere is rejected), and HTML is never served.
 */
export async function openPluginAsset(
  plugin: PluginInfo | undefined,
  hash: string,
  relative: string,
): Promise<PluginAsset | null> {
  if (!plugin || !/^[a-f0-9]{64}$/.test(hash) || !isSafePluginPath(relative)) return null;
  if (
    plugin.status !== "enabled" ||
    !plugin.enabled ||
    !plugin.trusted ||
    !plugin.browser ||
    !plugin.path ||
    plugin.browser.hash !== hash
  )
    return null;
  const entry = resolve(plugin.path, plugin.browser.entry);
  const root = dirname(entry);
  if (root === resolve(plugin.path) || !root.startsWith(`${resolve(plugin.path)}${sep}`))
    return null;
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
  const type = mimeTypes[extname(target).toLowerCase()];
  if (!type) return null;
  try {
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = await handle.stat();
    if (!stats.isFile()) {
      await handle.close();
      return null;
    }
    return { stream: handle.createReadStream(), size: stats.size, type };
  } catch {
    return null;
  }
}
