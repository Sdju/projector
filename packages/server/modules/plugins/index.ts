import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { validatePluginManifest } from "@ai-projector/core/modules/plugins/index.ts";
import { ensurePluginDependencies } from "./deps.ts";
import { packagesDirectory } from "./directory.ts";
import { discoverPlugins } from "./discover.ts";
import { copyPackage, destinationFor } from "./install.ts";
import { loadPluginPackage, readJson } from "./load.ts";
import { deleteState, readState, updateState } from "./state.ts";
import { removePluginStorage } from "./storage.ts";
import { hashPackage } from "./trust.ts";
import type { PluginCatalog } from "./types.ts";
import { installedProjectorVersion } from "./version.ts";

export { readPluginIcon } from "./icon.ts";
export { watchPluginDirectory } from "./watch.ts";
export { openPluginAsset, type PluginAsset } from "./assets.ts";
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

export async function installPlugin(sourcePath: unknown): Promise<PluginCatalog> {
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
  try {
    await lstat(destination);
    throw new Error("Эта версия плагина уже установлена");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await copyPackage(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST")
      await rm(destination, { recursive: true, force: true });
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error("Эта версия плагина уже установлена");
    throw error;
  }
  // Theme-only packages are safe to enable at once. Browser/server/agent code needs explicit trust.
  const requiresTrust =
    (manifest.projector.contributes.agents?.length ?? 0) > 0 ||
    (manifest.projector.contributes.balances?.length ?? 0) > 0 ||
    !!manifest.projector.server ||
    !!manifest.projector.browser;
  await updateState(manifest.name, {
    enabled: !requiresTrust,
    version: manifest.version,
  });
  return discoverPlugins();
}
