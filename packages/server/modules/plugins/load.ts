import { lstat, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  externalThemeId,
  pluginPackageKey,
  validatePluginManifest,
  validateThemeTokens,
  type AvailableTheme,
  type PluginBrowserEntry,
  type PluginManifest,
} from "@ai-projector/core/modules/plugins/index.ts";
import type { PluginDiagnostic } from "./types.ts";

type Contributions = PluginManifest["projector"]["contributes"];
type AgentContributions = NonNullable<Contributions["agents"]>;
type BalanceContributions = NonNullable<Contributions["balances"]>;
type LanguageContributions = NonNullable<Contributions["languages"]>;
type PanelContributions = NonNullable<Contributions["panels"]>;
type TabContributions = NonNullable<Contributions["tabs"]>;

export async function readJson(path: string): Promise<unknown> {
  const content = await readFile(path, "utf8");
  if (content.length > 1_000_000) throw new Error("Файл плагина слишком большой");
  return JSON.parse(content);
}

export interface PluginPackageCandidate {
  path: string;
  source: "managed" | "direct";
}

export interface LoadedPluginPackage {
  manifest: PluginManifest;
  diagnostics: PluginDiagnostic[];
  themes: AvailableTheme[];
  agents: AgentContributions;
  balances: BalanceContributions;
  languages: LanguageContributions;
  panels: PanelContributions;
  tabs: TabContributions;
  server?: string;
  browser?: PluginBrowserEntry;
}

/** Reads one installed package and every declared entry; diagnostics stay per contribution. */
export async function loadPluginPackage(
  candidate: PluginPackageCandidate,
  projectorVersion?: string,
): Promise<LoadedPluginPackage> {
  const manifest = validatePluginManifest(await readJson(join(candidate.path, "package.json")), {
    projectorVersion,
  });
  const diagnostics: PluginDiagnostic[] = [];
  const themes: AvailableTheme[] = [];
  let server: string | undefined;
  let browser: PluginBrowserEntry | undefined;
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
  if (manifest.projector.browser) {
    try {
      const path = resolve(candidate.path, manifest.projector.browser);
      if (!path.startsWith(`${resolve(candidate.path)}${sep}`))
        throw new Error("Небезопасный путь к browser-entry");
      const stats = await lstat(path);
      if (!stats.isFile() || stats.isSymbolicLink())
        throw new Error("browser-entry должен быть обычным файлом");
      browser = {
        entry: manifest.projector.browser,
        key: pluginPackageKey(manifest.name),
      };
    } catch (error) {
      diagnostics.push({
        message: `browser: ${error instanceof Error ? error.message : "Ошибка чтения browser-entry"}`,
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
    balances: manifest.projector.contributes.balances ?? [],
    languages: manifest.projector.contributes.languages ?? [],
    panels: manifest.projector.contributes.panels ?? [],
    tabs: manifest.projector.contributes.tabs ?? [],
    server,
    browser,
  };
}
