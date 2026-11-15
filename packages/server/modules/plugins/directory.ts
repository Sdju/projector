import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";

/**
 * The plugin root is shared by discovery, the catalog API and per-package data. It lives here, not
 * in `index.ts`, so that the storage module does not import the discovery barrel back.
 */
export function pluginsDirectory(): string {
  return join(dataDir(), "plugins");
}

export function packagesDirectory(): string {
  return join(pluginsDirectory(), "packages");
}

/** Reserved for per-package key-value state; never scanned as a package folder. */
export function pluginsDataDirectory(): string {
  return join(pluginsDirectory(), "data");
}
