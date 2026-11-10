import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  externalThemeId,
  validatePluginManifest,
  validateThemeTokens,
  type AvailableTheme,
  type PluginManifest,
} from "@ai-projector/core/modules/plugins/index.ts";

export type PluginStatus = "enabled" | "disabled" | "error" | "missing";

export interface PluginDiagnostic {
  message: string;
}

export interface PluginInfo {
  id: string;
  version?: string;
  description?: string;
  status: PluginStatus;
  enabled: boolean;
  path?: string;
  diagnostics: PluginDiagnostic[];
  themes: AvailableTheme[];
}

export interface PluginCatalog {
  directory: string;
  plugins: PluginInfo[];
  availableThemes: AvailableTheme[];
}

interface StoredPluginState {
  enabled: boolean;
  version?: string;
}

type PluginState = Record<string, StoredPluginState>;

interface Candidate {
  path: string;
  source: "managed" | "direct";
}

const currentProjectorVersion = "0.11.0";
let pending: Promise<unknown> = Promise.resolve();

export function pluginsDirectory(): string {
  return join(dataDir(), "plugins");
}

function packagesDirectory(): string {
  return join(pluginsDirectory(), "packages");
}

function statePath(): string {
  return join(dataDir(), "plugins.json");
}

async function readJson(path: string): Promise<unknown> {
  const content = await readFile(path, "utf8");
  if (content.length > 1_000_000) throw new Error("Файл плагина слишком большой");
  return JSON.parse(content);
}

async function readState(): Promise<PluginState> {
  try {
    const value = await readJson(statePath());
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const source =
      "plugins" in value && value.plugins && typeof value.plugins === "object"
        ? value.plugins
        : value;
    const state: PluginState = {};
    for (const [id, entry] of Object.entries(source)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.enabled === "boolean")
        state[id] = {
          enabled: item.enabled,
          version: typeof item.version === "string" ? item.version : undefined,
        };
    }
    return state;
  } catch {
    return {};
  }
}

async function updateState(id: string, value: StoredPluginState): Promise<void> {
  const task = pending.then(async () => {
    const state = await readState();
    state[id] = value;
    await mkdir(dataDir(), { recursive: true });
    const file = statePath();
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify({ plugins: state }, null, 2)}\n`, {
        mode: 0o600,
      });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  });
  pending = task.catch(() => undefined);
  return task;
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

async function managedCandidates(): Promise<Candidate[]> {
  const result: Candidate[] = [];
  for (const first of await directoriesAt(packagesDirectory())) {
    if (basename(first).startsWith("@")) {
      for (const second of await directoriesAt(first))
        for (const version of await directoriesAt(second))
          result.push({ path: version, source: "managed" });
    } else {
      for (const version of await directoriesAt(first))
        result.push({ path: version, source: "managed" });
    }
  }
  return result;
}

async function directCandidates(): Promise<Candidate[]> {
  const result: Candidate[] = [];
  for (const path of await directoriesAt(pluginsDirectory())) {
    if (["packages", "data"].includes(basename(path))) continue;
    try {
      if ((await lstat(join(path, "package.json"))).isFile())
        result.push({ path, source: "direct" });
    } catch {
      // A directory without a manifest is not an installed package.
    }
  }
  return result;
}

async function loadPackage(candidate: Candidate, state: StoredPluginState | undefined) {
  const manifest = validatePluginManifest(await readJson(join(candidate.path, "package.json")), {
    projectorVersion: currentProjectorVersion,
  });
  const diagnostics: PluginDiagnostic[] = [];
  const themes: AvailableTheme[] = [];
  for (const theme of manifest.projector.contributes.themes) {
    try {
      const path = resolve(candidate.path, theme.tokens);
      if (!path.startsWith(`${resolve(candidate.path)}${sep}`))
        throw new Error("Небезопасный путь к токенам");
      const stats = await lstat(path);
      if (!stats.isFile() || stats.isSymbolicLink())
        throw new Error("Файл токенов должен быть обычным файлом");
      const tokens = validateThemeTokens(await readJson(path));
      themes.push({
        id: externalThemeId(manifest.name, theme.id),
        packageName: manifest.name,
        title: theme.title,
        description: theme.description,
        mode: theme.mode,
        tokens,
      });
    } catch (error) {
      diagnostics.push({
        message: `${theme.id}: ${error instanceof Error ? error.message : "Ошибка чтения темы"}`,
      });
    }
  }
  return { manifest, diagnostics, themes, state };
}

export async function discoverPlugins(): Promise<PluginCatalog> {
  const state = await readState();
  const candidates = [...(await managedCandidates()), ...(await directCandidates())];
  const grouped = new Map<string, { candidate: Candidate; manifest: PluginManifest }[]>();
  const malformed: PluginInfo[] = [];
  for (const candidate of candidates) {
    try {
      const manifest = validatePluginManifest(
        await readJson(join(candidate.path, "package.json")),
        {
          projectorVersion: currentProjectorVersion,
        },
      );
      const versions = grouped.get(manifest.name) ?? [];
      versions.push({ candidate, manifest });
      grouped.set(manifest.name, versions);
    } catch (error) {
      malformed.push({
        id: candidate.path,
        path: candidate.path,
        status: "error",
        enabled: false,
        diagnostics: [{ message: error instanceof Error ? error.message : "Некорректный плагин" }],
        themes: [],
      });
    }
  }
  const plugins: PluginInfo[] = [...malformed];
  const availableThemes: AvailableTheme[] = [];
  for (const [id, versions] of grouped) {
    const saved = state[id];
    const selected = saved?.version
      ? versions.filter((entry) => entry.manifest.version === saved.version)
      : versions;
    const uniqueSources = new Set(
      versions.map((entry) => `${entry.manifest.name}@${entry.manifest.version}`),
    );
    if (selected.length !== 1 || uniqueSources.size !== versions.length) {
      plugins.push({
        id,
        status: "error",
        enabled: false,
        diagnostics: [
          {
            message: selected.length
              ? "Обнаружены повторяющиеся пакеты"
              : "Выбранная версия отсутствует",
          },
        ],
        themes: [],
      });
      continue;
    }
    try {
      const loaded = await loadPackage(selected[0].candidate, saved);
      const enabled = saved?.enabled ?? false;
      plugins.push({
        id,
        version: loaded.manifest.version,
        description: loaded.manifest.description,
        path: selected[0].candidate.path,
        status: loaded.diagnostics.length ? "error" : enabled ? "enabled" : "disabled",
        enabled,
        diagnostics: loaded.diagnostics,
        themes: loaded.themes,
      });
      if (enabled && !loaded.diagnostics.length) availableThemes.push(...loaded.themes);
    } catch (error) {
      plugins.push({
        id,
        status: "error",
        enabled: false,
        path: selected[0].candidate.path,
        diagnostics: [
          { message: error instanceof Error ? error.message : "Ошибка чтения плагина" },
        ],
        themes: [],
      });
    }
  }
  for (const [id, saved] of Object.entries(state)) {
    if (!grouped.has(id))
      plugins.push({
        id,
        version: saved.version,
        status: "missing",
        enabled: saved.enabled,
        diagnostics: [{ message: "Пакет плагина отсутствует" }],
        themes: [],
      });
  }
  plugins.sort((left, right) => left.id.localeCompare(right.id));
  availableThemes.sort((left, right) => left.id.localeCompare(right.id));
  return { directory: pluginsDirectory(), plugins, availableThemes };
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<PluginCatalog> {
  const catalog = await discoverPlugins();
  const plugin = catalog.plugins.find((item) => item.id === id);
  if (!plugin || plugin.status === "missing" || plugin.status === "error")
    throw new Error("Плагин недоступен для изменения состояния");
  await updateState(id, { enabled, version: plugin.version });
  return discoverPlugins();
}

function destinationFor(manifest: PluginManifest): string {
  const destination = resolve(packagesDirectory(), ...manifest.name.split("/"), manifest.version);
  if (!destination.startsWith(`${resolve(packagesDirectory())}${sep}`))
    throw new Error("Небезопасный путь установки");
  return destination;
}

async function copyPackage(source: string, destination: string): Promise<void> {
  const stats = await lstat(source);
  if (stats.isSymbolicLink()) throw new Error("Символические ссылки в плагинах не поддерживаются");
  if (stats.isDirectory()) {
    await mkdir(destination);
    for (const entry of await readdir(source))
      await copyPackage(join(source, entry), join(destination, entry));
    return;
  }
  if (!stats.isFile()) throw new Error("Плагин может содержать только обычные файлы и папки");
  await writeFile(destination, await readFile(source), { flag: "wx" });
}

export async function installPlugin(sourcePath: unknown): Promise<PluginCatalog> {
  if (typeof sourcePath !== "string" || !sourcePath)
    throw new Error("Укажите путь к папке плагина");
  const source = await realpath(resolve(sourcePath));
  if (!(await lstat(source)).isDirectory()) throw new Error("Плагин должен быть папкой");
  const manifest = validatePluginManifest(await readJson(join(source, "package.json")), {
    projectorVersion: currentProjectorVersion,
  });
  const loaded = await loadPackage({ path: source, source: "direct" }, undefined);
  if (loaded.diagnostics.length) throw new Error(loaded.diagnostics[0].message);
  const destination = destinationFor(manifest);
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
  await updateState(manifest.name, { enabled: true, version: manifest.version });
  return discoverPlugins();
}
