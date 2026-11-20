import {
  pluginHttpAccessOf,
  pluginHttpMethodsOf,
  pluginHttpPath,
  pluginPackageKey,
  type AvailableTheme,
  type PluginHttpContribution,
} from "@ai-projector/core/modules/plugins/index.ts";
import type { PluginInfo, PluginStatus } from "./client.ts";

export type PluginKindFilter = "all" | "themes" | "agents" | "ui" | "code" | "issues";
export type ThemeModeFilter = "all" | "dark" | "light";
export type PluginPageTab = "readme" | "features";

export const pluginPageTabs: { id: PluginPageTab; title: string }[] = [
  { id: "readme", title: "Readme" },
  { id: "features", title: "Возможности" },
];

export const pluginKindFilters: { id: PluginKindFilter; title: string }[] = [
  { id: "all", title: "Все" },
  { id: "themes", title: "Темы" },
  { id: "agents", title: "Агенты" },
  { id: "ui", title: "Интерфейс" },
  { id: "code", title: "Код" },
  { id: "issues", title: "Проблемы" },
];

export const themeModeFilters: { id: ThemeModeFilter; title: string }[] = [
  { id: "all", title: "Все темы" },
  { id: "dark", title: "Тёмные" },
  { id: "light", title: "Светлые" },
];

export const pluginStatusLabels: Record<PluginStatus, string> = {
  enabled: "Включён",
  disabled: "Выключен",
  error: "Ошибка",
  missing: "Отсутствует",
};

export function isPluginKindFilter(value: string): value is PluginKindFilter {
  return pluginKindFilters.some((item) => item.id === value);
}

export function isThemeModeFilter(value: string): value is ThemeModeFilter {
  return themeModeFilters.some((item) => item.id === value);
}

export function isPluginPageTab(value: string): value is PluginPageTab {
  return pluginPageTabs.some((item) => item.id === value);
}

export function defaultPluginPageTab(plugin: PluginInfo): PluginPageTab {
  return plugin.readme ? "readme" : "features";
}

/** Kind chips only when the catalog actually splits; a single family does not need a taxonomy. */
export function visiblePluginKindFilters(plugins: PluginInfo[], kind: PluginKindFilter) {
  const present = pluginKindFilters.filter(
    (item) =>
      item.id !== "all" &&
      (item.id === kind || plugins.some((plugin) => pluginMatchesKind(plugin, item.id))),
  );
  if (present.length <= 1 && kind === "all") return [];
  if (!present.length) return [];
  return [pluginKindFilters[0]!, ...present];
}

/** Dark/light only on the themes slice, and only when both modes are installed. */
export function visibleThemeModeFilters(plugins: PluginInfo[], kind: PluginKindFilter) {
  if (kind !== "themes") return [];
  const themes = plugins.flatMap((plugin) => plugin.themes);
  const dark = themes.some((theme) => theme.mode === "dark");
  const light = themes.some((theme) => theme.mode === "light");
  return dark && light ? themeModeFilters : [];
}

export function pluginHasUi(plugin: PluginInfo) {
  return plugin.languages.length > 0 || plugin.panels.length > 0 || plugin.tabs.length > 0;
}

export function pluginHasCode(plugin: PluginInfo) {
  return plugin.requiresTrust === true || plugin.code === true;
}

export function pluginHasIssues(plugin: PluginInfo) {
  return plugin.status === "error" || plugin.status === "missing" || plugin.diagnostics.length > 0;
}

export function pluginNeedsTrust(plugin: PluginInfo) {
  return plugin.requiresTrust === true && !plugin.trusted;
}

export function pluginMatchesKind(plugin: PluginInfo, kind: PluginKindFilter) {
  if (kind === "all") return true;
  if (kind === "themes") return plugin.themes.length > 0;
  if (kind === "agents") return plugin.agents.length > 0;
  if (kind === "ui") return pluginHasUi(plugin);
  if (kind === "code") return pluginHasCode(plugin);
  return pluginHasIssues(plugin);
}

export function pluginMatchesThemeMode(plugin: PluginInfo, mode: ThemeModeFilter) {
  if (mode === "all") return true;
  if (plugin.themes.some((theme) => theme.mode === mode)) return true;
  return plugin.themes.length === 0;
}

export function pluginMatchesQuery(plugin: PluginInfo, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const agents = plugin.agents.map((agent) => agent.title).join(" ");
  return `${plugin.id} ${plugin.description ?? ""} ${agents}`.toLocaleLowerCase().includes(needle);
}

export function filterPlugins(
  plugins: PluginInfo[],
  query: string,
  kind: PluginKindFilter,
  mode: ThemeModeFilter,
) {
  const applyThemeMode = kind === "themes";
  return plugins.filter(
    (plugin) =>
      pluginMatchesQuery(plugin, query) &&
      pluginMatchesKind(plugin, kind) &&
      (!applyThemeMode || pluginMatchesThemeMode(plugin, mode)),
  );
}

export function pluginRowIcon(plugin: PluginInfo) {
  if (pluginHasIssues(plugin)) return "circle-alert";
  if (pluginNeedsTrust(plugin)) return "shield-alert";
  if (plugin.agents.length) return "bot";
  if (plugin.themes.length) return "palette";
  if (pluginHasUi(plugin)) return "layout-template";
  if (plugin.http.length) return "globe";
  return "package";
}

export function pluginRowCaption(plugin: PluginInfo) {
  const parts: string[] = [];
  if (plugin.version) parts.push(`v${plugin.version}`);
  if (plugin.agents.length === 1) parts.push(plugin.agents[0]!.title);
  else if (plugin.agents.length > 1) parts.push(`${plugin.agents.length} агента`);
  else if (plugin.themes.length === 1) parts.push(plugin.themes[0]!.title);
  else if (plugin.themes.length > 1) parts.push(`${plugin.themes.length} схемы`);
  else if (pluginHasUi(plugin)) parts.push("интерфейс");
  if (pluginNeedsTrust(plugin)) parts.push("нужно доверие");
  if (pluginHasIssues(plugin)) parts.push(pluginStatusLabels[plugin.status]);
  return parts.join(" · ");
}

export function pluginKindHint(plugin: PluginInfo) {
  if (pluginHasCode(plugin)) {
    if (plugin.browser && plugin.server) return "Браузерный и серверный код · без песочницы";
    if (plugin.browser) return "Доверенный браузерный код, панели и вкладки";
    if (plugin.server) return "ACP-агент с доверенным серверным кодом";
    if (plugin.agents.length) return "ACP-агент · нуждается в доверии";
    if (plugin.http.length) return "HTTP-маршруты доверенного серверного кода";
  }
  if (plugin.agents.length) return "ACP-агент и темы · только данные, без кода";
  if (plugin.themes.length) return "Темы интерфейса · только данные, без кода";
  if (pluginHasUi(plugin)) return "Панели и вкладки";
  return "Локальный пакет";
}

export function pluginStatusTone(status: PluginStatus) {
  return status === "error" || status === "missing"
    ? "danger"
    : status === "enabled"
      ? "info"
      : "neutral";
}

export function themePreviewStyle(theme: AvailableTheme) {
  return {
    "--preview-bg": theme.tokens.bg,
    "--preview-panel": theme.tokens["bg-2"],
    "--preview-text": theme.tokens.text,
    "--preview-muted": theme.tokens.muted,
    "--preview-accent": theme.tokens.accent,
    "--preview-line": theme.tokens.line,
  };
}

export function pluginHttpUrl(pluginId: string, route: PluginHttpContribution) {
  return `/api/plugins/${pluginPackageKey(pluginId)}/${pluginHttpPath(route)}`;
}

export function pluginHttpMethodsLabel(route: PluginHttpContribution) {
  return pluginHttpMethodsOf(route).join(" · ");
}

export function pluginHttpAccessLabel(route: PluginHttpContribution) {
  return pluginHttpAccessOf(route) === "local"
    ? "локальные вызовы без Origin"
    : "страница Projector";
}

export function shortPluginHash(hash?: string) {
  if (!hash) return "";
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function pluginSummary(plugins: PluginInfo[]) {
  return {
    total: plugins.length,
    enabled: plugins.filter((plugin) => plugin.enabled && plugin.status === "enabled").length,
    trust: plugins.filter(pluginNeedsTrust).length,
    issues: plugins.filter(pluginHasIssues).length,
  };
}

export function pluginHasRuntimeContributions(plugin: PluginInfo) {
  return (
    plugin.agents.length > 0 ||
    plugin.balances.length > 0 ||
    plugin.http.length > 0 ||
    pluginHasUi(plugin)
  );
}

export function pluginHasContributions(plugin: PluginInfo) {
  return plugin.themes.length > 0 || pluginHasRuntimeContributions(plugin);
}
