import { join } from "node:path";
import {
  pluginPackageKey,
  projectPluginId,
  type PluginAgentContribution,
  type PluginBalanceContribution,
  type PluginHttpContribution,
  type PluginLanguageContribution,
  type PluginPanelContribution,
  type PluginTabContribution,
} from "@ai-projector/core/modules/plugins/index.ts";
import { loadPluginPackage, pluginHasReadme } from "../plugins/index.ts";
import type { PluginInfo } from "../plugins/index.ts";
import { projectRoot } from "../trusted-project-file/index.ts";
import { applyProjectPluginCode } from "./code.ts";
import { materializeProjectPlugin } from "./cache.ts";
import { projectPluginsRelativeDirectory } from "./directory.ts";
import { readProjectPluginIntent } from "./intent.ts";
import { scanProjectPlugins, type ProjectPluginCandidate } from "./scan.ts";
import { readProjectPluginState } from "./state.ts";
import { projectPluginRequiresTrust } from "./trust.ts";

export interface ProjectPluginCatalog {
  projectId: string;
  root: string;
  file: string;
  plugins: PluginInfo[];
}

export interface DiscoverProjectPluginsOptions {
  /** Asset and storage requests read one package without loading its server code again. */
  applyCode?: boolean;
}

function emptyCatalog(projectId: string): ProjectPluginCatalog {
  return { projectId, root: "", file: "", plugins: [] };
}

interface EntryInput {
  projectId: string;
  candidate: ProjectPluginCandidate;
  path: string;
  status: PluginInfo["status"];
  enabled: boolean;
  trusted: boolean;
  requiresTrust: boolean;
  diagnostics: { message: string }[];
  browser?: PluginInfo["browser"];
  server?: string;
  readme?: boolean;
  agents: PluginAgentContribution[];
  balances: PluginBalanceContribution[];
  http: PluginHttpContribution[];
  languages: PluginLanguageContribution[];
  panels: PluginPanelContribution[];
  tabs: PluginTabContribution[];
  dependencies?: Record<string, string>;
}

function pluginInfo(input: EntryInput): PluginInfo {
  const { candidate, projectId } = input;
  const id = projectPluginId(projectId, candidate.name);
  return {
    id,
    packageName: candidate.name,
    scope: "project",
    projectId,
    version: candidate.version,
    description: candidate.manifest.description,
    path: input.path,
    source: candidate.source,
    status: input.status,
    enabled: input.enabled,
    trusted: input.trusted,
    requiresTrust: input.requiresTrust,
    hash: candidate.hash,
    ...(input.server ? { server: input.server } : {}),
    ...(input.browser ? { browser: input.browser } : {}),
    code: !!input.server || !!input.browser,
    ...(input.readme ? { readme: true } : {}),
    diagnostics: input.diagnostics,
    // Project theme ids would collide with the global appearance choice; project appearance owns
    // per-project palettes, so themes are not offered from a project package yet.
    themes: [],
    agents: input.agents,
    balances: input.balances,
    http: input.http,
    languages: input.languages,
    panels: input.panels,
    tabs: input.tabs,
    ...(input.dependencies && Object.keys(input.dependencies).length
      ? { dependencies: input.dependencies }
      : {}),
  };
}

function errorEntry(
  projectId: string,
  name: string,
  source: string | undefined,
  message: string,
): PluginInfo {
  return {
    id: projectPluginId(projectId, name),
    packageName: name,
    scope: "project",
    projectId,
    ...(source ? { path: source, source } : {}),
    status: "error",
    enabled: false,
    trusted: false,
    requiresTrust: false,
    code: false,
    diagnostics: [{ message }],
    themes: [],
    agents: [],
    balances: [],
    http: [],
    languages: [],
    panels: [],
    tabs: [],
  };
}

/**
 * The catalog of `.projector/plugins` for one project. Reading manifests and hashing files is
 * safe; only trusted and enabled packages are copied to the cache, loaded or registered.
 */
export async function discoverProjectPlugins(
  projectId: string,
  options: DiscoverProjectPluginsOptions = {},
): Promise<ProjectPluginCatalog> {
  let root: string;
  try {
    root = await projectRoot(projectId);
  } catch {
    return emptyCatalog(projectId);
  }
  const file = join(root, projectPluginsRelativeDirectory);
  const scan = await scanProjectPlugins(root);
  const state = await readProjectPluginState();
  const saved = state[root] ?? {};
  const intent = await readProjectPluginIntent(root);
  const grouped = new Map<string, ProjectPluginCandidate[]>();
  for (const candidate of scan.packages) {
    const list = grouped.get(candidate.name) ?? [];
    list.push(candidate);
    grouped.set(candidate.name, list);
  }
  const plugins: PluginInfo[] = [];
  for (const problem of scan.problems)
    plugins.push(errorEntry(projectId, problem.name ?? "invalid", problem.source, problem.message));

  for (const [name, candidates] of grouped) {
    if (candidates.length !== 1) {
      plugins.push(
        errorEntry(projectId, name, candidates[0]?.source, "Обнаружены повторяющиеся пакеты"),
      );
      continue;
    }
    const candidate = candidates[0]!;
    const entry = saved[name];
    const enabled = entry?.enabled ?? intent[name] ?? false;
    const manifest = candidate.manifest;
    const balances = manifest.projector.contributes.balances ?? [];
    const http = manifest.projector.contributes.http ?? [];
    const requiresTrust = projectPluginRequiresTrust(manifest);
    const trusted = !requiresTrust || entry?.trustedHash === candidate.hash;
    const diagnostics: { message: string }[] = [];
    if (enabled && !trusted)
      diagnostics.push({
        message: entry?.trustedHash
          ? "Содержимое плагина изменилось; подтвердите доверие заново"
          : "Плагину требуется подтверждение доверия в проекте",
      });
    if (balances.length)
      diagnostics.push({
        message: "Денежные балансы провайдеров не поддерживаются плагинами проекта",
      });
    if (http.length && !manifest.projector.server)
      diagnostics.push({ message: "HTTP-маршруты требуют projector.server" });

    let selectedPath = candidate.source;
    if (trusted && enabled && requiresTrust) {
      try {
        selectedPath = await materializeProjectPlugin(candidate.source, root, name, candidate.hash);
      } catch (error) {
        diagnostics.push({
          message:
            error instanceof Error
              ? `Не удалось подготовить копию плагина: ${error.message}`
              : "Не удалось подготовить копию плагина",
        });
      }
    }

    let loaded;
    try {
      loaded = await loadPluginPackage({ path: selectedPath, source: "direct" });
      diagnostics.push(...loaded.diagnostics);
    } catch (error) {
      plugins.push(
        errorEntry(
          projectId,
          name,
          candidate.source,
          error instanceof Error ? error.message : "Не удалось прочитать плагин",
        ),
      );
      continue;
    }
    const readme = await pluginHasReadme(selectedPath).catch(() => false);
    plugins.push(
      pluginInfo({
        projectId,
        candidate,
        path: selectedPath,
        status: diagnostics.length ? "error" : enabled ? "enabled" : "disabled",
        enabled,
        trusted,
        requiresTrust,
        diagnostics,
        ...(loaded.server ? { server: loaded.server } : {}),
        ...(loaded.browser
          ? {
              browser: {
                ...loaded.browser,
                key: pluginPackageKey(projectPluginId(projectId, name)),
                hash: candidate.hash,
              },
            }
          : {}),
        ...(readme ? { readme: true } : {}),
        agents: loaded.agents,
        balances: loaded.balances,
        http: loaded.http,
        languages: loaded.languages,
        panels: loaded.panels,
        tabs: loaded.tabs,
        ...(manifest.dependencies && Object.keys(manifest.dependencies).length
          ? { dependencies: manifest.dependencies }
          : {}),
      }),
    );
  }

  if (options.applyCode !== false) await applyProjectPluginCode(projectId, plugins);
  plugins.sort((left, right) => left.id.localeCompare(right.id));
  return { projectId, root, file, plugins };
}
