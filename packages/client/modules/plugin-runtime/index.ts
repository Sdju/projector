import { pluginPackageKey } from "@ai-projector/core/modules/plugins/index.ts";

export {
  refreshPluginRuntime,
  applyRuntimeCatalog,
  initPluginRuntime,
  disposePluginRuntime,
} from "./runtime.ts";
export {
  languageRevision,
  runtimeAgents,
  runtimeCommands,
  runtimeIssues,
  runtimeLanguages,
  runtimePanels,
  runtimeTabs,
  runtimeThemeSettings,
  findLanguage,
  findRuntimeAgent,
  reportIssue,
  type ActiveAgent,
  type ActiveCommand,
  type ActiveLanguage,
  type ActivePanel,
  type ActiveTab,
  type PluginRuntimeIssue,
} from "./store.ts";
export { mountThemeSettings } from "./mount.ts";
export { default as PluginContributionMount } from "./ui/PluginMount.vue";
export { default as PluginUsageMount } from "./ui/PluginUsageMount.vue";

export function pluginPanelKind(packageName: string, id: string): string {
  return `plugin:${pluginPackageKey(packageName)}:panel:${id}`;
}

export function pluginTabKind(packageName: string, id: string): string {
  return `plugin:${pluginPackageKey(packageName)}:tab:${id}`;
}

export function pluginPanelCommandId(packageName: string, id: string): string {
  return `ide.plugin.panel.${pluginPackageKey(packageName)}.${id}.open`;
}

export function pluginTabCommandId(packageName: string, id: string): string {
  return `ide.plugin.tab.${pluginPackageKey(packageName)}.${id}.open`;
}
