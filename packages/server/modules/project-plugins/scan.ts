import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import {
  validatePluginManifest,
  type PluginManifest,
} from "@ai-projector/core/modules/plugins/index.ts";
import { hashPackage, installedProjectorVersion, readJson } from "../plugins/index.ts";
import { projectPluginsRelativeDirectory } from "./directory.ts";

export interface ProjectPluginCandidate {
  name: string;
  version: string;
  /** The package folder in the project working tree. */
  source: string;
  hash: string;
  manifest: PluginManifest;
}

export interface ProjectPluginProblem {
  name?: string;
  source?: string;
  message: string;
}

export interface ProjectPluginScan {
  packages: ProjectPluginCandidate[];
  problems: ProjectPluginProblem[];
}

async function directoriesAt(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const result: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = join(path, entry.name);
      if ((await lstat(child)).isSymbolicLink()) continue;
      result.push(child);
    }
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Reads only package manifests and hashes regular files. Nothing is executed here: a repository
 * can be cloned and inspected safely, and code starts only after the user trusts its exact bytes.
 */
export async function scanProjectPlugins(root: string): Promise<ProjectPluginScan> {
  const requested = join(root, projectPluginsRelativeDirectory);
  const packages: ProjectPluginCandidate[] = [];
  const problems: ProjectPluginProblem[] = [];
  let directory: string;
  try {
    directory = await realpath(requested);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { packages, problems };
    throw error;
  }
  if (!directory.startsWith(`${root}${sep}`)) {
    problems.push({ message: "Каталог плагинов проекта указывает за его пределы" });
    return { packages, problems };
  }
  for (const source of await directoriesAt(directory)) {
    try {
      const stats = await lstat(join(source, "package.json"));
      if (!stats.isFile() || stats.isSymbolicLink()) continue;
      const manifest = validatePluginManifest(await readJson(join(source, "package.json")), {
        projectorVersion: installedProjectorVersion(),
      });
      const hash = await hashPackage(source);
      packages.push({
        name: manifest.name,
        version: manifest.version,
        source,
        hash,
        manifest,
      });
    } catch (error) {
      problems.push({
        name: basename(source),
        source,
        message: error instanceof Error ? error.message : "Некорректный плагин проекта",
      });
    }
  }
  return { packages, problems };
}
