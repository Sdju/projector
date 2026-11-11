import type {
  AvailableTheme,
  PluginAgentContribution,
} from "@ai-projector/core/modules/plugins/index.ts";

export type PluginStatus = "enabled" | "disabled" | "error" | "missing";

export interface PluginInfo {
  id: string;
  version?: string;
  description?: string;
  status: PluginStatus;
  enabled: boolean;
  trusted: boolean;
  path?: string;
  diagnostics: { message: string }[];
  themes: AvailableTheme[];
  agents: PluginAgentContribution[];
}

export interface PluginCatalog {
  directory: string;
  plugins: PluginInfo[];
  availableThemes: AvailableTheme[];
}

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch("/api/plugins", {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Не удалось выполнить действие с плагином");
  return data;
}

/** Older servers and test fixtures omit the agent fields; the screen still needs arrays. */
function normalizeCatalog(catalog: PluginCatalog): PluginCatalog {
  return {
    ...catalog,
    plugins: catalog.plugins.map((plugin) => ({
      ...plugin,
      trusted: plugin.trusted === true,
      agents: Array.isArray(plugin.agents) ? plugin.agents : [],
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
  const response = await fetch("/api/appearance", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ choice }),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(data.error || "Не удалось применить тему");
}
