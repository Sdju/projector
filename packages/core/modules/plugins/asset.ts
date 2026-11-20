/**
 * Stable address pieces of a browser plugin. The package key is base64url of the npm name, so a
 * scoped name never introduces an ambiguous extra path segment. The content hash is part of the
 * path, not a query: relative ESM chunks inherit it automatically.
 */

const keyPattern = /^[A-Za-z0-9_-]+$/;

export function pluginPackageKey(packageName: string): string {
  const bytes = new TextEncoder().encode(packageName);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function pluginPackageName(key: string): string | null {
  if (!keyPattern.test(key)) return null;
  try {
    const padded = key.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Rejects absolute paths, traversal, backslashes and NUL in a package-relative asset path. */
export function isSafePluginPath(relative: string): boolean {
  if (!relative || relative.length > 500 || relative.includes("\0") || relative.includes("\\"))
    return false;
  if (relative.startsWith("/") || /^[A-Za-z]:/.test(relative)) return false;
  return relative.split("/").every((segment) => !!segment && segment !== "." && segment !== "..");
}

/** `/api/plugins/assets/<key>/<hash>/<relative>` on the device that owns the package. */
export function pluginAssetPath(packageName: string, hash: string, relative: string): string {
  if (!isSafePluginPath(relative)) throw new Error("Небезопасный путь к ассету плагина");
  const path = relative.split("/").map(encodeURIComponent).join("/");
  return `/api/plugins/assets/${pluginPackageKey(packageName)}/${hash}/${path}`;
}

/** `/api/plugins/<key>/readme` or a package-relative image next to the README. */
export function pluginReadmePath(packageName: string, relative?: string): string {
  const base = `/api/plugins/${pluginPackageKey(packageName)}/readme`;
  if (!relative) return base;
  if (!isSafePluginPath(relative)) throw new Error("Небезопасный путь к файлу README плагина");
  return `${base}/${relative.split("/").map(encodeURIComponent).join("/")}`;
}

/** Reserved namespace for a package's own IDE commands; it cannot shadow host commands. */
export function pluginCommandPrefix(packageName: string): string {
  return `ide.plugin.command.${pluginPackageKey(packageName)}.`;
}
