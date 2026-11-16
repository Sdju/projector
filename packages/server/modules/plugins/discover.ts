import { lstat, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  validatePluginManifest,
  type AvailableTheme,
  type PluginManifest,
} from "@ai-projector/core/modules/plugins/index.ts";
import { syncPluginTrustNotices, type RevokedPlugin } from "../trust-notices/index.ts";
import { packagesDirectory, pluginsDirectory } from "./directory.ts";
import { loadPluginPackage, readJson } from "./load.ts";
import { readState } from "./state.ts";
import { hashPackage, isTrusted } from "./trust.ts";
import type { PluginApply, PluginCatalog, PluginCodeDiagnostic, PluginInfo } from "./types.ts";
import { installedProjectorVersion } from "./version.ts";

interface Candidate {
  path: string;
  source: "managed" | "direct";
}

let applyPluginRegistry: PluginApply = () => [];

/** The composition owns the agent and balance registries; discovery only asks it to reconcile. */
export function configurePluginCode(apply: PluginApply): void {
  applyPluginRegistry = apply;
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
          projectorVersion: installedProjectorVersion(),
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
        requiresTrust: false,
        code: false,
        diagnostics: [{ message: error instanceof Error ? error.message : "Некорректный плагин" }],
        themes: [],
        agents: [],
        balances: [],
        http: [],
        languages: [],
        panels: [],
        tabs: [],
      });
    }
  }
  const plugins: PluginInfo[] = [...malformed];
  const availableThemes: AvailableTheme[] = [];
  const revoked: RevokedPlugin[] = [];
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
        requiresTrust: false,
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
        balances: [],
        http: [],
        languages: [],
        panels: [],
        tabs: [],
      });
      continue;
    }
    try {
      const loaded = await loadPluginPackage(selected[0].candidate, installedProjectorVersion());
      const enabled = saved?.enabled ?? false;
      const agents = loaded.agents;
      const balances = loaded.balances;
      const requiresTrust =
        agents.length > 0 || balances.length > 0 || !!loaded.server || !!loaded.browser;
      const currentHash = requiresTrust ? await hashPackage(selected[0].candidate.path) : undefined;
      const trusted = !requiresTrust || isTrusted(saved?.trustedHash, currentHash);
      const diagnostics = [...loaded.diagnostics];
      if (enabled && !trusted)
        diagnostics.push({
          message: saved?.trustedHash
            ? "Содержимое плагина изменилось; подтвердите доверие заново"
            : "Плагину требуется подтверждение доверия",
        });
      if (enabled && saved?.trustedHash && !trusted)
        revoked.push({
          plugin: id,
          name: agents[0]?.title ?? balances[0]?.title ?? id,
          agents: agents.length > 0,
          hash: currentHash,
        });
      plugins.push({
        id,
        version: loaded.manifest.version,
        description: loaded.manifest.description,
        path: selected[0].candidate.path,
        status: diagnostics.length ? "error" : enabled ? "enabled" : "disabled",
        enabled,
        trusted,
        requiresTrust,
        ...(currentHash ? { hash: currentHash } : {}),
        ...(loaded.server ? { server: loaded.server } : {}),
        ...(loaded.browser && currentHash
          ? { browser: { ...loaded.browser, hash: currentHash } }
          : {}),
        code: !!loaded.server || !!loaded.browser,
        diagnostics,
        themes: loaded.themes,
        agents,
        balances,
        http: loaded.http,
        languages: loaded.languages,
        panels: loaded.panels,
        tabs: loaded.tabs,
        ...(loaded.manifest.dependencies && Object.keys(loaded.manifest.dependencies).length
          ? { dependencies: loaded.manifest.dependencies }
          : {}),
      });
      if (enabled && trusted && !diagnostics.length) availableThemes.push(...loaded.themes);
    } catch (error) {
      plugins.push({
        id,
        status: "error",
        enabled: false,
        trusted: false,
        requiresTrust: false,
        code: false,
        path: selected[0].candidate.path,
        diagnostics: [
          { message: error instanceof Error ? error.message : "Ошибка чтения плагина" },
        ],
        themes: [],
        agents: [],
        balances: [],
        http: [],
        languages: [],
        panels: [],
        tabs: [],
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
        requiresTrust: false,
        code: false,
        diagnostics: [{ message: "Пакет плагина отсутствует" }],
        themes: [],
        agents: [],
        balances: [],
        http: [],
        languages: [],
        panels: [],
        tabs: [],
      });
  }
  await syncPluginTrustNotices(revoked);
  await applyPluginCatalog(plugins, availableThemes);
  plugins.sort((left, right) => left.id.localeCompare(right.id));
  availableThemes.sort((left, right) => left.id.localeCompare(right.id));
  return { directory: pluginsDirectory(), plugins, availableThemes };
}

/** Registers enabled code through the composition callback and turns its diagnostics into errors. */
async function applyPluginCatalog(
  plugins: PluginInfo[],
  availableThemes: AvailableTheme[],
): Promise<void> {
  const candidates = plugins
    .filter((plugin) => plugin.status === "enabled" && plugin.trusted)
    .filter(
      (plugin) => plugin.agents.length > 0 || plugin.balances.length > 0 || plugin.http.length > 0,
    )
    .map((plugin) => ({
      plugin: plugin.id,
      ...(plugin.path ? { path: plugin.path } : {}),
      ...(plugin.server ? { server: plugin.server } : {}),
      ...(plugin.hash ? { hash: plugin.hash } : {}),
      agents: plugin.agents,
      balances: plugin.balances,
      http: plugin.http,
    }));
  let diagnostics: PluginCodeDiagnostic[] = [];
  try {
    diagnostics = await applyPluginRegistry(candidates);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось применить плагины";
    for (const candidate of candidates) {
      const subject =
        candidate.agents[0]?.id ?? candidate.balances[0]?.kind ?? candidate.http[0]?.id;
      diagnostics.push({
        plugin: candidate.plugin,
        ...(subject ? { subject } : {}),
        message,
      });
    }
  }
  for (const item of diagnostics) {
    const plugin = plugins.find((entry) => entry.id === item.plugin);
    if (!plugin) continue;
    plugin.diagnostics.push({
      message: item.subject ? `${item.subject}: ${item.message}` : item.message,
    });
    plugin.status = "error";
    for (let index = availableThemes.length - 1; index >= 0; index--)
      if (availableThemes[index]!.packageName === item.plugin) availableThemes.splice(index, 1);
  }
}
