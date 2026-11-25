import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { validatePluginManifest } from "@ai-projector/core/modules/plugins/index.ts";
import { buildPluginSource } from "./build.ts";
import { ensurePluginDependencies } from "./deps.ts";
import { packagesDirectory } from "./directory.ts";
import { discoverPlugins } from "./discover.ts";
import { copyPackage, destinationFor } from "./install.ts";
import { loadPluginPackage, readJson } from "./load.ts";
import { deleteState, readState, updateState, type StoredPluginState } from "./state.ts";
import { removePluginStorage } from "./storage.ts";
import { hashPackage } from "./trust.ts";
import type { PluginCatalog } from "./types.ts";
import { installedProjectorVersion } from "./version.ts";

export { readPluginIcon } from "./icon.ts";
export { watchPluginDirectory } from "./watch.ts";
export { copyPackage } from "./install.ts";
export { loadPluginPackage, readJson, type LoadedPluginPackage } from "./load.ts";
export { hashPackage, isTrusted } from "./trust.ts";
export { installedProjectorVersion } from "./version.ts";
export { openPluginAsset, type PluginAsset } from "./assets.ts";
export { openPluginReadmeFile, pluginHasReadme, readPluginReadme } from "./readme.ts";
export { packagesDirectory, pluginsDataDirectory, pluginsDirectory } from "./directory.ts";
export { configurePluginCode, discoverPlugins } from "./discover.ts";
export {
  PluginStorageLimitError,
  PluginStoragePathError,
  deletePluginStorageValue,
  pluginPackageExists,
  pluginStorageDirectory,
  pluginStorageFile,
  readPluginStorage,
  removePluginStorage,
  writePluginStorageValue,
} from "./storage.ts";
export type {
  PluginApply,
  PluginCandidate,
  PluginCatalog,
  PluginCodeDiagnostic,
  PluginDiagnostic,
  PluginInfo,
  PluginStatus,
} from "./types.ts";

export async function setPluginEnabled(id: string, enabled: boolean): Promise<PluginCatalog> {
  const catalog = await discoverPlugins();
  const plugin = catalog.plugins.find((item) => item.id === id);
  if (!plugin || plugin.status === "missing")
    throw new Error("Плагин недоступен для изменения состояния");
  if (enabled && plugin.status === "error")
    throw new Error("Плагин содержит ошибки; исправьте их перед включением");
  if (enabled && plugin.requiresTrust && !plugin.trusted)
    throw new Error("Сначала подтвердите доверие к исполняемому коду плагина");
  const state = await readState();
  const current = state[id] ?? { enabled: false };
  await updateState(id, { ...current, enabled, version: plugin.version });
  return discoverPlugins();
}

/** Confirms the exact content of a plugin that contributes code. */
export async function trustPlugin(id: string): Promise<PluginCatalog> {
  const catalog = await discoverPlugins();
  const plugin = catalog.plugins.find((item) => item.id === id);
  if (!plugin || plugin.status === "missing" || !plugin.path)
    throw new Error("Плагин не найден на диске");
  if (!plugin.requiresTrust) throw new Error("Плагин не содержит исполняемого кода");
  if (plugin.server) {
    const manifest = validatePluginManifest(await readJson(join(plugin.path, "package.json")), {
      projectorVersion: installedProjectorVersion(),
    });
    await ensurePluginDependencies(plugin.path, manifest);
  }
  const trustedHash = await hashPackage(plugin.path);
  const state = await readState();
  const current = state[id] ?? { enabled: false };
  await updateState(id, {
    ...current,
    enabled: plugin.enabled,
    version: plugin.version,
    trustedHash,
  });
  return discoverPlugins();
}

/** Removes a managed installation and its data; a hand-placed folder stays where the user put it. */
export async function removePlugin(id: string): Promise<PluginCatalog> {
  const catalog = await discoverPlugins();
  const plugin = catalog.plugins.find((item) => item.id === id);
  if (!plugin || plugin.status === "missing" || !plugin.path)
    throw new Error("Плагин не найден на диске");
  if (!resolve(plugin.path).startsWith(`${resolve(packagesDirectory())}${sep}`))
    throw new Error("Плагин установлен вручную; удалите его папку");
  await rm(plugin.path, { recursive: true, force: true });
  await deleteState(id);
  await removePluginStorage(id);
  return discoverPlugins();
}

export interface InstallPluginOptions {
  /** Replace the managed copy of the same version (a local rebuild). */
  replace?: boolean;
  /** Trust the installed content and enable it without a separate confirmation. */
  trust?: boolean;
}

export async function installPlugin(
  sourcePath: unknown,
  options: InstallPluginOptions = {},
): Promise<PluginCatalog> {
  if (typeof sourcePath !== "string" || !sourcePath)
    throw new Error("Укажите путь к папке плагина");
  const source = await realpath(resolve(sourcePath));
  if (!(await lstat(source)).isDirectory()) throw new Error("Плагин должен быть папкой");
  const manifest = validatePluginManifest(await readJson(join(source, "package.json")), {
    projectorVersion: installedProjectorVersion(),
  });
  const loaded = await loadPluginPackage(
    { path: source, source: "direct" },
    installedProjectorVersion(),
  );
  if (loaded.diagnostics.length) throw new Error(loaded.diagnostics[0].message);
  const destination = destinationFor(manifest, packagesDirectory());
  await mkdir(dirname(destination), { recursive: true });
  const exists = await lstat(destination).then(
    () => true,
    () => false,
  );
  if (exists && !options.replace) throw new Error("Эта версия плагина уже установлена");
  if (exists) {
    const staging = `${destination}.staging-${randomUUID()}`;
    try {
      await copyPackage(source, staging);
      await rm(destination, { recursive: true, force: true });
      await rename(staging, destination);
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  } else {
    try {
      await copyPackage(source, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST")
        await rm(destination, { recursive: true, force: true });
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error("Эта версия плагина уже установлена");
      throw error;
    }
  }
  // Theme-only packages are safe to enable at once. Browser/server/agent code needs explicit trust.
  const requiresTrust =
    loaded.agents.length > 0 ||
    loaded.balances.length > 0 ||
    !!manifest.projector.server ||
    !!manifest.projector.browser;
  const state: StoredPluginState = {
    enabled: !requiresTrust,
    version: manifest.version,
    source,
  };
  if (options.trust && requiresTrust) {
    if (manifest.projector.server) await ensurePluginDependencies(destination, manifest);
    state.enabled = true;
    state.trustedHash = await hashPackage(destination);
  }
  await updateState(manifest.name, state);
  return discoverPlugins();
}

export interface RebuildPluginOptions {
  /** The installed package whose saved source folder should be rebuilt. */
  id?: string;
  /** A source folder to build instead of the saved one. */
  path?: string;
}

function managedPath(path: string): boolean {
  return resolve(path).startsWith(`${resolve(packagesDirectory())}${sep}`);
}

function samePath(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Builds a local plugin folder, installs the result and trusts it as the user's explicit action. */
export async function rebuildPlugin(options: RebuildPluginOptions = {}): Promise<PluginCatalog> {
  const id = typeof options.id === "string" ? options.id.trim() : "";
  const catalog = await discoverPlugins();
  const current = id ? catalog.plugins.find((item) => item.id === id) : undefined;
  let source = typeof options.path === "string" ? options.path.trim() : "";
  if (!source && id)
    source =
      (await readState())[id]?.source ??
      (current?.path && !managedPath(current.path) ? current.path : "");
  if (!source) throw new Error("Укажите папку с исходниками плагина");
  const resolved = await realpath(resolve(source));
  if (!(await lstat(resolved)).isDirectory()) throw new Error("Плагин должен быть папкой");
  const manifest = validatePluginManifest(await readJson(join(resolved, "package.json")), {
    projectorVersion: installedProjectorVersion(),
  });
  if (id && manifest.name !== id)
    throw new Error(`Папка содержит плагин ${manifest.name}, а не ${id}`);
  const existing = catalog.plugins.find((item) => item.id === manifest.name);
  if (existing?.path && !managedPath(existing.path)) {
    if (!samePath(existing.path, resolved))
      throw new Error("Плагин установлен вручную; укажите его папку как источник");
    await buildPluginSource(resolved);
    if (existing.requiresTrust) await trustPlugin(manifest.name);
    return setPluginEnabled(manifest.name, true);
  }
  await buildPluginSource(resolved);
  return installPlugin(resolved, { replace: true, trust: true });
}
