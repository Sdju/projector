import type {
  AvailableTheme,
  PluginAgentContribution,
  PluginBalanceContribution,
  PluginBrowserEntry,
  PluginHttpContribution,
  PluginLanguageContribution,
  PluginPanelContribution,
  PluginTabContribution,
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
  /** The user confirmed this exact package content; required before any code may run. */
  trusted: boolean;
  /** The package contributes browser, server or agent code and therefore needs trust. */
  requiresTrust: boolean;
  /** Current content hash, used to reload code only when the package really changed. */
  hash?: string;
  /** Absolute path of the trusted server-side code entry, when the package has one. */
  server?: string;
  /** Package-relative browser ESM entry, its asset key and the content hash. */
  browser?: PluginBrowserEntry & { hash: string };
  /** The package runs code in the server or the page; it is not a declarative-only plugin. */
  code: boolean;
  path?: string;
  dependencies?: Record<string, string>;
  diagnostics: PluginDiagnostic[];
  themes: AvailableTheme[];
  agents: PluginAgentContribution[];
  /** Provider kinds whose money balance the plugin knows how to read. */
  balances: PluginBalanceContribution[];
  /** HTTP routes served under `/api/plugins/<key>/...` by the trusted server code. */
  http: PluginHttpContribution[];
  languages: PluginLanguageContribution[];
  panels: PluginPanelContribution[];
  tabs: PluginTabContribution[];
}

export interface PluginCatalog {
  directory: string;
  plugins: PluginInfo[];
  availableThemes: AvailableTheme[];
}

/** One enabled code plugin, tagged with everything its module may register. */
export interface PluginCandidate {
  plugin: string;
  /** Absolute directory of the installed package; SVG icons are read from here. */
  path?: string;
  /** Absolute code entry of the package, when the package runs server code. */
  server?: string;
  /** Content hash that scopes the loaded code module. */
  hash?: string;
  agents: PluginAgentContribution[];
  balances: PluginBalanceContribution[];
  http: PluginHttpContribution[];
}

/** A collision or an invalid contribution found while applying the catalog; shown on the card. */
export interface PluginCodeDiagnostic {
  plugin: string;
  /** Agent id or balance kind the diagnostic belongs to. */
  subject?: string;
  message: string;
}

export type PluginApply = (
  plugins: PluginCandidate[],
) => PluginCodeDiagnostic[] | Promise<PluginCodeDiagnostic[]>;
