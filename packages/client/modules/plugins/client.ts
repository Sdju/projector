import type {
  AvailableTheme,
  PluginAgentContribution,
  PluginBrowserEntry,
  PluginLanguageContribution,
  PluginPanelContribution,
  PluginTabContribution,
} from "@ai-projector/core/modules/plugins/index.ts";

export type PluginStatus = "enabled" | "disabled" | "error" | "missing";

export interface PluginInfo {
  id: string;
  version?: string;
  description?: string;
  status: PluginStatus;
  enabled: boolean;
  trusted: boolean;
  requiresTrust?: boolean;
  code?: boolean;
  hash?: string;
  server?: string;
  browser?: PluginBrowserEntry & { hash: string };
  path?: string;
  diagnostics: { message: string }[];
  themes: AvailableTheme[];
  agents: PluginAgentContribution[];
  languages: PluginLanguageContribution[];
  panels: PluginPanelContribution[];
  tabs: PluginTabContribution[];
  dependencies?: Record<string, string>;
}

export interface PluginCatalog {
  directory: string;
  plugins: PluginInfo[];
  availableThemes: AvailableTheme[];
}

import { deviceUrl } from "../../common/utilities/device-url.ts";

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch(deviceUrl("/api/plugins"), {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Не удалось выполнить действие с плагином");
  return data;
}

/** Older servers and test fixtures omit newer fields; the screen and runtime still need arrays. */
function normalizeCatalog(catalog: PluginCatalog): PluginCatalog {
  return {
    ...catalog,
    plugins: catalog.plugins.map((plugin) => ({
      ...plugin,
      trusted: plugin.trusted === true,
      requiresTrust:
        plugin.requiresTrust ?? (plugin.code === true || (plugin.agents?.length ?? 0) > 0),
      code: plugin.code === true,
      agents: Array.isArray(plugin.agents) ? plugin.agents : [],
      languages: Array.isArray(plugin.languages) ? plugin.languages : [],
      panels: Array.isArray(plugin.panels) ? plugin.panels : [],
      tabs: Array.isArray(plugin.tabs) ? plugin.tabs : [],
    })),
  };
}

export function fetchPlugins(): Promise<PluginCatalog> {
  return request<PluginCatalog>().then(normalizeCatalog);
}

export function pluginAction(
  action: "refresh" | "enable" | "disable" | "install" | "trust" | "remove",
  body: { id?: string; path?: string } = {},
): Promise<PluginCatalog> {
  return request<PluginCatalog>({ method: "POST", body: JSON.stringify({ action, ...body }) }).then(
    normalizeCatalog,
  );
}

export async function saveAppearance(choice: string): Promise<void> {
  const response = await fetch(deviceUrl("/api/appearance"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ choice }),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(data.error || "Не удалось применить тему");
}
