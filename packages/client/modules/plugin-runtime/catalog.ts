import { deviceUrl } from "../../common/utilities/device-url.ts";
import type {
  AvailableTheme,
  PluginAgentContribution,
  PluginBrowserEntry,
  PluginHttpContribution,
  PluginLanguageContribution,
  PluginPanelContribution,
  PluginTabContribution,
} from "@ai-projector/core/modules/plugins/index.ts";

/** Catalog shape the browser runtime needs; the settings screen has its own richer copy. */
export interface RuntimePluginInfo {
  /** Unique runtime id: a project plugin carries `project:<project-key>:<package>`. */
  id: string;
  /** Manifest package name; the public `api.packageName` value. */
  packageName?: string;
  /** Set for a package from `.projector/plugins` of the named project. */
  projectId?: string;
  scope?: "user" | "project";
  version?: string;
  status: "enabled" | "disabled" | "error" | "missing";
  enabled: boolean;
  trusted: boolean;
  hash?: string;
  browser?: PluginBrowserEntry & { hash: string };
  languages: PluginLanguageContribution[];
  panels: PluginPanelContribution[];
  tabs: PluginTabContribution[];
  themes?: AvailableTheme[];
  agents: PluginAgentContribution[];
  http: PluginHttpContribution[];
  diagnostics: { message: string }[];
}

export interface RuntimeCatalog {
  plugins: RuntimePluginInfo[];
}

function normalize(value: unknown): RuntimeCatalog {
  const catalog = value as { plugins?: unknown };
  const plugins = Array.isArray(catalog?.plugins) ? catalog.plugins : [];
  return {
    plugins: plugins.flatMap((entry): RuntimePluginInfo[] => {
      if (!entry || typeof entry !== "object") return [];
      const plugin = entry as Record<string, unknown>;
      if (typeof plugin.id !== "string") return [];
      return [
        {
          id: plugin.id,
          packageName: typeof plugin.packageName === "string" ? plugin.packageName : plugin.id,
          ...(typeof plugin.projectId === "string" ? { projectId: plugin.projectId } : {}),
          ...(plugin.scope === "project" || plugin.scope === "user" ? { scope: plugin.scope } : {}),
          version: typeof plugin.version === "string" ? plugin.version : undefined,
          status:
            plugin.status === "enabled" ||
            plugin.status === "disabled" ||
            plugin.status === "error" ||
            plugin.status === "missing"
              ? plugin.status
              : "error",
          enabled: plugin.enabled === true,
          trusted: plugin.trusted === true,
          hash: typeof plugin.hash === "string" ? plugin.hash : undefined,
          browser:
            plugin.browser && typeof plugin.browser === "object"
              ? (plugin.browser as RuntimePluginInfo["browser"])
              : undefined,
          languages: Array.isArray(plugin.languages)
            ? (plugin.languages as PluginLanguageContribution[])
            : [],
          panels: Array.isArray(plugin.panels) ? (plugin.panels as PluginPanelContribution[]) : [],
          tabs: Array.isArray(plugin.tabs) ? (plugin.tabs as PluginTabContribution[]) : [],
          themes: Array.isArray(plugin.themes) ? (plugin.themes as AvailableTheme[]) : [],
          agents: Array.isArray(plugin.agents) ? (plugin.agents as PluginAgentContribution[]) : [],
          http: Array.isArray(plugin.http) ? (plugin.http as PluginHttpContribution[]) : [],
          diagnostics: Array.isArray(plugin.diagnostics)
            ? (plugin.diagnostics as { message: string }[])
            : [],
        },
      ];
    }),
  };
}

/** Reads the device-aware catalog; the same path works directly and through the Hub tunnel. */
export async function fetchRuntimeCatalog(
  projectId?: string,
  signal?: AbortSignal,
): Promise<RuntimeCatalog> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const response = await fetch(deviceUrl(`/api/plugins${query}`), {
    headers: { Accept: "application/json" },
    signal,
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(data.error || "Не удалось прочитать каталог плагинов");
  return normalize(data);
}
