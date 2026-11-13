import { pluginPackageKey } from "@ai-projector/core/modules/plugins/index.ts";

export {
  refreshPluginRuntime,
  applyRuntimeCatalog,
  initPluginRuntime,
  disposePluginRuntime,
} from "./runtime.ts";
export {
  languageRevision,
  runtimeCommands,
  runtimeIssues,
  runtimeLanguages,
  runtimePanels,
  runtimeTabs,
  findLanguage,
  reportIssue,
  type ActiveCommand,
  type ActiveLanguage,
  type ActivePanel,
  type ActiveTab,
  type PluginRuntimeIssue,
} from "./store.ts";
export { default as PluginContributionMount } from "./ui/PluginMount.vue";

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
