import { createHash } from "node:crypto";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { pluginsDirectory } from "../plugins/index.ts";

/** Packages committed next to the project's other Projector files. */
export const projectPluginsRelativeDirectory = ".projector/plugins";

/** Optional intent file: which discovered packages the repository wants enabled. */
export const projectPluginsRelativeFile = ".projector/plugins.json";

/** Device state of project plugins: trust hashes and the user's enable/disable decision. */
export function projectPluginStateFile(): string {
  return join(dataDir(), "project-plugins.json");
}

/** Trusted packages are copied here; the repository itself is never executed in place. */
export function projectPluginCacheDirectory(): string {
  return join(pluginsDirectory(), "projects");
}

/** A stable, path-safe directory for one project root. */
export function projectPluginCacheKey(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 32);
}
