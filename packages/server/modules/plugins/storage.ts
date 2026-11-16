import { lstat, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  isPluginPackageName,
  parsePluginStorage,
  pluginPackageKey,
  pluginStorageBytes,
  pluginStorageKey,
  pluginStorageMaxBytes,
  serializePluginStorage,
  serializePluginStorageValue,
} from "@ai-projector/core/modules/plugins/index.ts";
import { setAsideBroken, withFileLock, writeFileAtomic } from "../atomic-files/index.ts";
import { packagesDirectory, pluginsDataDirectory, pluginsDirectory } from "./directory.ts";
import { readState } from "./state.ts";

export type PluginStorageData = Record<string, unknown>;

/** The package exists on this device: it is either installed or still recorded in the state file. */
export class PluginStoragePathError extends Error {
  constructor(message = "Каталог данных плагина недоступен") {
    super(message);
    this.name = "PluginStoragePathError";
  }
}

export class PluginStorageLimitError extends Error {
  constructor() {
    super(`Хранилище плагина ограничено ${pluginStorageMaxBytes} байтами`);
    this.name = "PluginStorageLimitError";
  }
}

export function pluginStorageDirectory(name: string): string {
  return join(pluginsDataDirectory(), pluginPackageKey(name));
}

/** `plugins/data/<package-key>/state.json`: the key is base64url, so a name never adds segments. */
export function pluginStorageFile(name: string): string {
  return join(pluginStorageDirectory(name), "state.json");
}

/**
 * Data is allowed while the package is installed or remembered, including disabled and missing
 * ones: settings must survive a disable, and a temporarily absent folder must not lose them.
 */
export async function pluginPackageExists(name: string): Promise<boolean> {
  if (!isPluginPackageName(name)) return false;
  const state = await readState();
  if (state[name]) return true;
  try {
    const stats = await lstat(join(packagesDirectory(), name));
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

async function ensureDirectory(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new PluginStoragePathError();
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(path);
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new PluginStoragePathError();
}

/** Reading must not create folders: an unread package leaves no trace in `plugins/data`. */
async function directoryExists(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new PluginStoragePathError();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function checkStorageDirectory(name: string): Promise<boolean> {
  if (!(await directoryExists(pluginsDataDirectory()))) return false;
  return directoryExists(pluginStorageDirectory(name));
}

async function ensureStorageDirectory(name: string): Promise<void> {
  // The plugin root is created by the server before discovery; only `data` and the package folder
  // are checked segment by segment, because a planted symlink would escape the plugin directory.
  await mkdir(pluginsDirectory(), { recursive: true });
  await ensureDirectory(pluginsDataDirectory());
  await ensureDirectory(pluginStorageDirectory(name));
}

async function readDocument(name: string): Promise<PluginStorageData> {
  const file = pluginStorageFile(name);
  if (!(await checkStorageDirectory(name))) return {};
  let text: string;
  try {
    const stats = await lstat(file);
    if (stats.isSymbolicLink() || !stats.isFile())
      throw new PluginStoragePathError("Файл данных плагина недоступен");
    if (stats.size > pluginStorageMaxBytes) throw new PluginStorageLimitError();
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const data = parsePluginStorage(text);
  if (data) return data;
  // The damaged file is preserved, not overwritten: the next write starts from an empty object.
  await setAsideBroken(file);
  console.warn(`Плагины: ${name}: файл данных повреждён и отложен`);
  return {};
}

async function writeDocument(name: string, data: PluginStorageData): Promise<void> {
  const text = serializePluginStorage(data);
  if (pluginStorageBytes(text) > pluginStorageMaxBytes) throw new PluginStorageLimitError();
  await writeFileAtomic(pluginStorageFile(name), text);
}

/** A whole-object read is atomic: the file is only ever replaced by rename. */
export async function readPluginStorage(name: string): Promise<PluginStorageData> {
  return withFileLock(pluginStorageFile(name), () => readDocument(name));
}

export async function writePluginStorageValue(
  name: string,
  key: unknown,
  value: unknown,
): Promise<void> {
  const item = pluginStorageKey(key);
  const serialized = serializePluginStorageValue(value);
  const file = pluginStorageFile(name);
  await withFileLock(file, async () => {
    await ensureStorageDirectory(name);
    const data = await readDocument(name);
    data[item] = JSON.parse(serialized) as unknown;
    await writeDocument(name, data);
  });
}

export async function deletePluginStorageValue(name: string, key: unknown): Promise<void> {
  const item = pluginStorageKey(key);
  const file = pluginStorageFile(name);
  await withFileLock(file, async () => {
    if (!(await checkStorageDirectory(name))) return;
    const data = await readDocument(name);
    if (!Object.hasOwn(data, item)) return;
    delete data[item];
    await writeDocument(name, data);
  });
}

/** Removing the installation removes its data; disabling and version changes keep it. */
export async function removePluginStorage(name: string): Promise<void> {
  await rm(pluginStorageDirectory(name), { recursive: true, force: true });
}
