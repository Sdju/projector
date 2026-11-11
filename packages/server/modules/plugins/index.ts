import { lstat, mkdir, readdir, readFile, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  externalThemeId,
  validatePluginManifest,
  validateThemeTokens,
  type AvailableTheme,
  type PluginManifest,
} from "@ai-projector/core/modules/plugins/index.ts";
import { copyPackage, destinationFor } from "./install.ts";
import { deleteState, readState, updateState } from "./state.ts";
import { hashPackage, isTrusted } from "./trust.ts";
import type {
  PluginAgentApply,
  PluginAgentDiagnostic,
  PluginCatalog,
  PluginDiagnostic,
  PluginInfo,
} from "./types.ts";

export type {
  PluginAgentApply,
  PluginAgentCandidate,
  PluginAgentDiagnostic,
  PluginCatalog,
  PluginDiagnostic,
  PluginInfo,
  PluginStatus,
} from "./types.ts";

interface Candidate {
  path: string;
  source: "managed" | "direct";
}

const currentProjectorVersion = "0.11.0";
let applyAgentRegistry: PluginAgentApply = () => [];

/** The composition owns the agent registry; discovery only asks it to reconcile the catalog. */
export function configurePluginAgents(apply: PluginAgentApply): void {
  applyAgentRegistry = apply;
}

export function pluginsDirectory(): string {
  return join(dataDir(), "plugins");
}

function packagesDirectory(): string {
  return join(pluginsDirectory(), "packages");
}

async function readJson(path: string): Promise<unknown> {
  const content = await readFile(path, "utf8");
  if (content.length > 1_000_000) throw new Error("Файл плагина слишком большой");
  return JSON.parse(content);
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

async function loadPackage(candidate: Candidate) {
  const manifest = validatePluginManifest(await readJson(join(candidate.path, "package.json")), {
    projectorVersion: currentProjectorVersion,
  });
  const diagnostics: PluginDiagnostic[] = [];
  const themes: AvailableTheme[] = [];
  let server: string | undefined;
  if (manifest.projector.server) {
    try {
      const path = resolve(candidate.path, manifest.projector.server);
      if (!path.startsWith(`${resolve(candidate.path)}${sep}`))
        throw new Error("Небезопасный путь к server-entry");
      const stats = await lstat(path);
      if (!stats.isFile() || stats.isSymbolicLink())
        throw new Error("server-entry должен быть обычным файлом");
      server = path;
    } catch (error) {
      diagnostics.push({
        message: `server: ${error instanceof Error ? error.message : "Ошибка чтения server-entry"}`,
      });
    }
  }
  for (const theme of manifest.projector.contributes.themes ?? []) {
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
  return {
    manifest,
    diagnostics,
    themes,
    agents: manifest.projector.contributes.agents ?? [],
    server,
  };
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
        trusted: false,
        code: false,
        diagnostics: [{ message: error instanceof Error ? error.message : "Некорректный плагин" }],
        themes: [],
        agents: [],
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
        trusted: false,
        code: false,
        diagnostics: [
          {
            message: selected.length
              ? "Обнаружены повторяющиеся пакеты"
              : "Выбранная версия отсутствует",
          },
        ],
        themes: [],
        agents: [],
      });
      continue;
    }
    try {
      const loaded = await loadPackage(selected[0].candidate);
      const enabled = saved?.enabled ?? false;
      const agents = loaded.agents;
      const requiresTrust = agents.length > 0 || !!loaded.server;
      const currentHash = requiresTrust ? await hashPackage(selected[0].candidate.path) : undefined;
      const trusted = !requiresTrust || isTrusted(saved?.trustedHash, currentHash);
      const diagnostics = [...loaded.diagnostics];
      if (enabled && !trusted)
        diagnostics.push({
          message: saved?.trustedHash
            ? "Содержимое плагина изменилось; подтвердите доверие заново"
            : "Агенту плагина требуется подтверждение доверия",
        });
      plugins.push({
        id,
        version: loaded.manifest.version,
        description: loaded.manifest.description,
        path: selected[0].candidate.path,
        status: diagnostics.length ? "error" : enabled ? "enabled" : "disabled",
        enabled,
        trusted,
        ...(currentHash ? { hash: currentHash } : {}),
        ...(loaded.server ? { server: loaded.server } : {}),
        code: !!loaded.server,
        diagnostics,
        themes: loaded.themes,
        agents,
      });
      if (enabled && trusted && !diagnostics.length) availableThemes.push(...loaded.themes);
    } catch (error) {
      plugins.push({
        id,
        status: "error",
        enabled: false,
        trusted: false,
        code: false,
        path: selected[0].candidate.path,
        diagnostics: [
          { message: error instanceof Error ? error.message : "Ошибка чтения плагина" },
        ],
        themes: [],
        agents: [],
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
        trusted: false,
        code: false,
        diagnostics: [{ message: "Пакет плагина отсутствует" }],
        themes: [],
        agents: [],
      });
  }
  await applyAgentCatalog(plugins, availableThemes);
  plugins.sort((left, right) => left.id.localeCompare(right.id));
  availableThemes.sort((left, right) => left.id.localeCompare(right.id));
  return { directory: pluginsDirectory(), plugins, availableThemes };
}

/** Registers enabled agents through the composition callback and turns its diagnostics into errors. */
async function applyAgentCatalog(
  plugins: PluginInfo[],
  availableThemes: AvailableTheme[],
): Promise<void> {
  const candidates = plugins
    .filter((plugin) => plugin.status === "enabled" && plugin.trusted)
    .flatMap((plugin) =>
      plugin.agents.map((agent) => ({
        plugin: plugin.id,
        agent,
        ...(plugin.server ? { server: plugin.server } : {}),
        ...(plugin.hash ? { hash: plugin.hash } : {}),
      })),
    );
  let diagnostics: PluginAgentDiagnostic[] = [];
  try {
    diagnostics = await applyAgentRegistry(candidates);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось применить агентов";
    for (const candidate of candidates)
      diagnostics.push({ plugin: candidate.plugin, agent: candidate.agent.id, message });
  }
  for (const item of diagnostics) {
    const plugin = plugins.find((entry) => entry.id === item.plugin);
    if (!plugin) continue;
    plugin.diagnostics.push({ message: `${item.agent}: ${item.message}` });
    plugin.status = "error";
    for (let index = availableThemes.length - 1; index >= 0; index--)
      if (availableThemes[index]!.packageName === item.plugin) availableThemes.splice(index, 1);
  }
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<PluginCatalog> {
  const catalog = await discoverPlugins();
  const plugin = catalog.plugins.find((item) => item.id === id);
  if (!plugin || plugin.status === "missing")
    throw new Error("Плагин недоступен для изменения состояния");
  if (enabled && plugin.status === "error")
    throw new Error("Плагин содержит ошибки; исправьте их перед включением");
  if (enabled && plugin.agents.length && !plugin.trusted)
    throw new Error("Сначала подтвердите доверие к агенту плагина");
  const state = await readState();
  const current = state[id] ?? { enabled: false };
  await updateState(id, { ...current, enabled, version: plugin.version });
  return discoverPlugins();
}

/** Confirms the exact content of a plugin that contributes agents. */
export async function trustPlugin(id: string): Promise<PluginCatalog> {
  const catalog = await discoverPlugins();
  const plugin = catalog.plugins.find((item) => item.id === id);
  if (!plugin || plugin.status === "missing" || !plugin.path)
    throw new Error("Плагин не найден на диске");
  if (!plugin.agents.length) throw new Error("Плагин не содержит агентов");
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

/** Removes a managed installation; a hand-placed folder stays where the user put it. */
export async function removePlugin(id: string): Promise<PluginCatalog> {
  const catalog = await discoverPlugins();
  const plugin = catalog.plugins.find((item) => item.id === id);
  if (!plugin || plugin.status === "missing" || !plugin.path)
    throw new Error("Плагин не найден на диске");
  if (!resolve(plugin.path).startsWith(`${resolve(packagesDirectory())}${sep}`))
    throw new Error("Плагин установлен вручную; удалите его папку");
  await rm(plugin.path, { recursive: true, force: true });
  await deleteState(id);
  return discoverPlugins();
}

export async function installPlugin(sourcePath: unknown): Promise<PluginCatalog> {
  if (typeof sourcePath !== "string" || !sourcePath)
    throw new Error("Укажите путь к папке плагина");
  const source = await realpath(resolve(sourcePath));
  if (!(await lstat(source)).isDirectory()) throw new Error("Плагин должен быть папкой");
  const manifest = validatePluginManifest(await readJson(join(source, "package.json")), {
    projectorVersion: currentProjectorVersion,
  });
  const loaded = await loadPackage({ path: source, source: "direct" });
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
  // Theme-only packages are safe to enable at once. An agent runs a process, so it waits for
  // an explicit trust confirmation before it can be switched on.
  const hasAgents = (manifest.projector.contributes.agents?.length ?? 0) > 0;
  await updateState(manifest.name, { enabled: !hasAgents, version: manifest.version });
  return discoverPlugins();
}
