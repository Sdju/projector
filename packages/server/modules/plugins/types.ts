import type {
  AvailableTheme,
  PluginAgentContribution,
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
  /** The user confirmed this exact package content; required before its agents may run. */
  trusted: boolean;
  /** Current content hash, used to reload a code entry only when the package really changed. */
  hash?: string;
  /** Absolute path of the trusted server-side code entry, when the package has one. */
  server?: string;
  /** The package runs code in the server process; it is not a declarative-only plugin. */
  code: boolean;
  path?: string;
  diagnostics: PluginDiagnostic[];
  themes: AvailableTheme[];
  agents: PluginAgentContribution[];
}

export interface PluginCatalog {
  directory: string;
  plugins: PluginInfo[];
  availableThemes: AvailableTheme[];
}

/** One agent a plugin contributes, tagged with the package it came from. */
export interface PluginAgentCandidate {
  plugin: string;
  agent: PluginAgentContribution;
  /** Absolute directory of the installed package; SVG icons are read from here. */
  path?: string;
  /** Absolute code entry of the package, when the package registers agents itself. */
  server?: string;
  /** Content hash that scopes the loaded code module. */
  hash?: string;
}

/** A collision or an invalid agent found while applying the catalog; shown on the plugin card. */
export interface PluginAgentDiagnostic {
  plugin: string;
  agent: string;
  message: string;
}

export type PluginAgentApply = (
  agents: PluginAgentCandidate[],
) => PluginAgentDiagnostic[] | Promise<PluginAgentDiagnostic[]>;
