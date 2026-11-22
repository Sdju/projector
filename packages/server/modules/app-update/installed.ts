import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectInstallSource,
  HUB_PACKAGE,
  IDE_PACKAGE,
  MANAGED_BY_NPM_ENV,
  managedByNpmFlag,
  NATIVE_PACKAGE,
  type InstallSource,
} from "@ai-projector/core/modules/app-update/index.ts";

export interface InstalledPackage {
  name: string;
  version?: string;
}

export interface InstalledApp {
  source: InstallSource;
  version?: string;
  path: string;
  native?: InstalledPackage;
  hub?: InstalledPackage;
}

interface Manifest {
  name?: string;
  version?: string;
}

function readManifest(file: string): Manifest | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    return {
      name: typeof record.name === "string" ? record.name : undefined,
      version: typeof record.version === "string" ? record.version : undefined,
    };
  } catch {
    return;
  }
}

/** Walks to the checkout root or the published `@ai-projector/ide` tree. */
export function findInstallRoot(start = dirname(fileURLToPath(import.meta.url))): string {
  let directory = start;
  for (;;) {
    const file = join(directory, "package.json");
    if (existsSync(file)) {
      const manifest = readManifest(file);
      if (manifest?.name === "projector" || manifest?.name === IDE_PACKAGE) return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) return start;
    directory = parent;
  }
}

function neighborVersion(root: string, name: string): InstalledPackage | undefined {
  const short = name.slice(name.lastIndexOf("/") + 1);
  const files = [
    join(dirname(root), short, "package.json"),
    join(root, "node_modules", name, "package.json"),
    join(root, "packages", short, "package.json"),
  ];
  for (const file of files) {
    const manifest = readManifest(file);
    if (manifest?.name === name) return { name, version: manifest.version };
  }
}

export function readInstalledApp(root = findInstallRoot()): InstalledApp {
  const manifest = readManifest(join(root, "package.json"));
  const source = detectInstallSource({
    packageName: manifest?.name,
    packagePath: root,
    managedByNpm: managedByNpmFlag(process.env[MANAGED_BY_NPM_ENV]),
  });
  return {
    source,
    version: manifest?.version,
    path: root,
    native: neighborVersion(root, NATIVE_PACKAGE),
    hub: neighborVersion(root, HUB_PACKAGE),
  };
}
