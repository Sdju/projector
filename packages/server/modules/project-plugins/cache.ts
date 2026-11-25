import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pluginPackageKey } from "@ai-projector/core/modules/plugins/index.ts";
import { copyPackage, hashPackage } from "../plugins/index.ts";
import { projectPluginCacheDirectory, projectPluginCacheKey } from "./directory.ts";

/**
 * The trusted copy of one project package for one content hash. Code and assets are served from
 * here, never from the working tree: a `git pull` can change the repository at any moment, but it
 * cannot change bytes the user already confirmed.
 */
export function projectPluginCachePath(root: string, packageName: string, hash: string): string {
  return join(
    projectPluginCacheDirectory(),
    projectPluginCacheKey(root),
    pluginPackageKey(packageName),
    hash,
  );
}

export async function cachedProjectPlugin(
  root: string,
  packageName: string,
  hash: string,
): Promise<string | undefined> {
  const path = projectPluginCachePath(root, packageName, hash);
  try {
    const stats = await lstat(path);
    return stats.isDirectory() && !stats.isSymbolicLink() ? path : undefined;
  } catch {
    return undefined;
  }
}

/** Copies a trusted package once; a staging directory makes an interrupted copy invisible. */
export async function materializeProjectPlugin(
  source: string,
  root: string,
  packageName: string,
  hash: string,
): Promise<string> {
  const destination = projectPluginCachePath(root, packageName, hash);
  const existing = await cachedProjectPlugin(root, packageName, hash);
  if (existing) return existing;
  await mkdir(dirname(destination), { recursive: true });
  const staging = `${destination}.staging-${randomUUID()}`;
  try {
    await copyPackage(source, staging);
    // The working tree may change between the catalog hash and the copy. The cache key must
    // describe the bytes that actually run, otherwise a confirmed hash could hide new code.
    if ((await hashPackage(staging)) !== hash)
      throw new Error("Содержимое плагина изменилось во время доверия; повторите попытку");
    await rename(staging, destination);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    // Two concurrent catalog reads may copy the same hash; the first rename wins.
    const raced = await cachedProjectPlugin(root, packageName, hash);
    if (raced) return raced;
    throw error;
  }
  return destination;
}
