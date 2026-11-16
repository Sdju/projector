import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PluginManifest } from "@ai-projector/core/modules/plugins/index.ts";

const run = promisify(execFile);
const stampName = ".projector-deps.json";

function desiredStamp(manifest: PluginManifest) {
  return {
    dependencies: manifest.dependencies ?? {},
    optionalDependencies: manifest.optionalDependencies ?? {},
  };
}

function resolves(pluginPath: string, names: string[]): boolean {
  if (!names.length) return true;
  try {
    const requireFromPlugin = createRequire(join(pluginPath, "package.json"));
    for (const name of names) requireFromPlugin.resolve(name);
    return true;
  } catch {
    return false;
  }
}

async function readStamp(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function writeStamp(
  pluginPath: string,
  desired: ReturnType<typeof desiredStamp>,
): Promise<void> {
  await mkdir(join(pluginPath, "node_modules"), { recursive: true });
  await writeFile(join(pluginPath, "node_modules", stampName), JSON.stringify(desired));
}

async function hasNodeModules(pluginPath: string): Promise<boolean> {
  try {
    return (await lstat(join(pluginPath, "node_modules"))).isDirectory();
  } catch {
    return false;
  }
}

/** Installs a trusted server plugin's own dependencies into its package, never the IDE's. */
export async function ensurePluginDependencies(
  pluginPath: string,
  manifest: PluginManifest,
): Promise<void> {
  if (!manifest.projector.server) return;
  const deps = Object.keys(manifest.dependencies ?? {});
  const optDeps = Object.keys(manifest.optionalDependencies ?? {});
  if (deps.length === 0 && optDeps.length === 0) return;
  const desired = desiredStamp(manifest);
  const stampPath = join(pluginPath, "node_modules", stampName);
  try {
    const stamp = await readStamp(stampPath);
    const ready = resolves(pluginPath, deps);
    if (stamp !== undefined && JSON.stringify(stamp) === JSON.stringify(desired) && ready) return;
    if (
      (await hasNodeModules(pluginPath)) &&
      ready &&
      (optDeps.length === 0 || stamp === undefined)
    ) {
      await writeStamp(pluginPath, desired);
      return;
    }
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    await run(
      npm,
      [
        "install",
        "--omit=dev",
        "--ignore-scripts",
        "--no-bin-links",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
      ],
      {
        cwd: pluginPath,
        timeout: 120_000,
        windowsHide: true,
        ...(process.platform === "win32" ? { shell: true } : {}),
      },
    );
    if (!resolves(pluginPath, deps)) throw new Error("зависимости не резолвятся после установки");
    await writeStamp(pluginPath, desired);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Не удалось установить зависимости плагина: ${msg}`);
  }
}
