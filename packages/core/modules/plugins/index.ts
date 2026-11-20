import {
  assertAllowedKeys,
  assertRecord,
  assertText,
  validateAgentContribution,
  type PluginAgentContribution,
} from "./agent.ts";
import { validateBalanceContribution, type PluginBalanceContribution } from "./balance.ts";
import { validateHttpContributions, type PluginHttpContribution } from "./http.ts";
import {
  assertBrowserEntry,
  validateBrowserContributions,
  type PluginLanguageContribution,
  type PluginPanelContribution,
  type PluginTabContribution,
} from "./browser.ts";
import type { PluginThemeContribution } from "./theme.ts";
import { validateThemeSettings } from "./theme-settings.ts";

export type {
  PluginAgentContribution,
  PluginAgentTerminal,
  PluginAgentUsageCommand,
} from "./agent.ts";
export type { PluginBalanceContribution } from "./balance.ts";
export {
  isPluginHttpPath,
  pluginHttpAccessOf,
  pluginHttpMethods,
  pluginHttpMethodsOf,
  pluginHttpPath,
  validateHttpContributions,
  type PluginHttpAccess,
  type PluginHttpContribution,
  type PluginHttpMethod,
} from "./http.ts";
export type {
  PluginBrowserContributions,
  PluginBrowserEntry,
  PluginLanguageContribution,
  PluginPanelContribution,
  PluginTabContribution,
} from "./browser.ts";
export {
  mergeThemeValues,
  resolveThemeValues,
  themeEffectProperties,
  themeEffectStyle,
  validateThemeSettings,
  type SavedThemeValues,
  type ThemeSeedOption,
  type ThemeSetting,
  type ThemeValues,
} from "./theme-settings.ts";
export { isPluginIconFile, sanitizePluginIconSvg } from "./icon.ts";
export {
  serializeThemeTokens,
  themeStyleProperties,
  themeTokenNames,
  validateThemeTokens,
} from "./theme.ts";
export type {
  AvailableTheme,
  PluginThemeContribution,
  ThemeTokenName,
  ThemeTokens,
} from "./theme.ts";
export {
  isSafePluginPath,
  pluginAssetPath,
  pluginCommandPrefix,
  pluginPackageKey,
  pluginPackageName,
  pluginReadmePath,
} from "./asset.ts";
export {
  parsePluginStorage,
  pluginStorageBytes,
  pluginStorageFits,
  pluginStorageKey,
  pluginStorageMaxBytes,
  pluginStorageMaxKeyLength,
  serializePluginStorage,
  serializePluginStorageValue,
  type PluginStorageDocument,
} from "./storage.ts";

export const pluginApiVersion = 1;

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  engines?: { projector?: string };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  projector: {
    apiVersion: typeof pluginApiVersion;
    /**
     * Server-side code entry inside the package, relative and never outside it.
     * The file runs in the Projector server process, so enabling it requires explicit user trust.
     */
    server?: string;
    /**
     * Browser ESM entry inside the package. It runs on the Projector/Hub page origin and therefore
     * requires the same explicit trust as server code; it is not a sandbox.
     */
    browser?: string;
    contributes: {
      themes?: PluginThemeContribution[];
      agents?: PluginAgentContribution[];
      balances?: PluginBalanceContribution[];
      http?: PluginHttpContribution[];
      languages?: PluginLanguageContribution[];
      panels?: PluginPanelContribution[];
      tabs?: PluginTabContribution[];
    };
  };
}

export interface PluginValidationOptions {
  projectorVersion?: string;
}

const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/;
const themeIdPattern = /^[a-z0-9][a-z0-9._-]*$/;
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const maxServerEntryLength = 300;
const serverEntryPattern = /^[A-Za-z0-9._/-]+\.cjs$/;

/**
 * `projector.server` points to a package-relative code entry executed inside the
 * Projector server process; enabling such a package requires explicit user trust.
 */
function assertServerEntry(value: unknown): void {
  if (typeof value !== "string" || !value.trim() || value.length > maxServerEntryLength)
    throw new Error(
      `projector.server: ожидается непустой путь до ${maxServerEntryLength} символов`,
    );
  if (/^[\\/]/.test(value) || /^[A-Za-z]:/.test(value))
    throw new Error("projector.server: путь должен быть относительным");
  if (value.split("/").some((segment) => segment === ".."))
    throw new Error("projector.server: недопустимы сегменты ..");
  if (!value.endsWith(".cjs")) throw new Error("projector.server: ожидается CommonJS-файл .cjs");
  if (!serverEntryPattern.test(value))
    throw new Error("projector.server: недопустимые символы в пути");
}

export function isPluginPackageName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 214 && packageNamePattern.test(value);
}

export function isExternalThemeId(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 300) return false;
  const slash = value.lastIndexOf("/");
  if (slash < 1) return false;
  const packageName = value.slice(0, slash);
  const id = value.slice(slash + 1);
  return isPluginPackageName(packageName) && themeIdPattern.test(id);
}

export function externalThemeId(packageName: string, id: string): string {
  return `${packageName}/${id}`;
}

function compareSemver(left: string, right: string): number {
  const a = left.split(/[-+]/, 1)[0].split(".").map(Number);
  const b = right.split(/[-+]/, 1)[0].split(".").map(Number);
  while (a.length < 3) a.push(0);
  while (b.length < 3) b.push(0);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

function satisfiesProjectorRange(version: string, range: string): boolean {
  if (range === "*" || range === "latest") return true;
  const alternatives = range.trim().split(/\s*\|\|\s*/);
  return alternatives.some((alternative) => {
    const parts = alternative.trim().split(/\s+/);
    return parts.every((part) => {
      const match = /^(>=|<=|>|<|=|\^|~)?\s*v?(\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?)$/.exec(part);
      if (!match) throw new Error("Некорректное требование engines.projector");
      const operator = match[1] ?? "=";
      const target = match[2];
      const comparison = compareSemver(version, target);
      if (operator === "^") {
        const major = Number(target.split(".", 1)[0]);
        return comparison >= 0 && Number(version.split(".", 1)[0]) === major;
      }
      if (operator === "~") {
        const [major, minor] = target.split(".").map(Number);
        const [currentMajor, currentMinor] = version.split(".").map(Number);
        return comparison >= 0 && currentMajor === major && currentMinor === minor;
      }
      return (
        (operator === ">=" && comparison >= 0) ||
        (operator === "<=" && comparison <= 0) ||
        (operator === ">" && comparison > 0) ||
        (operator === "<" && comparison < 0) ||
        (operator === "=" && comparison === 0)
      );
    });
  });
}

function validateDependencyMap(value: unknown, label: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} должен быть объектом`);
  const forbidden = ["__proto__", "constructor", "prototype"].find((key) =>
    Object.hasOwn(value, key),
  );
  if (forbidden) throw new Error(`${label}: недопустимое поле ${forbidden}`);
  const entries = Object.entries(value);
  if (entries.length > 200) throw new Error(`${label}: не более 200 записей`);
  for (const [key, spec] of entries) {
    if (!isPluginPackageName(key)) throw new Error(label + ": некорректное имя пакета " + key);
    if (
      typeof spec !== "string" ||
      !spec ||
      spec.length > 200 ||
      spec.includes("\n") ||
      spec.includes("\0")
    )
      throw new Error(
        `${label}: версия ${key} должна быть непустой строкой до 200 символов без переводов строк и NUL`,
      );
    if (/^(workspace|catalog|file|link|portal):/.test(spec))
      throw new Error(`${label}: недопустимый протокол у ${key}`);
  }
}

export function validatePluginManifest(
  value: unknown,
  options: PluginValidationOptions = {},
): PluginManifest {
  assertRecord(value, "Манифест плагина");
  assertAllowedKeys(
    value,
    [
      "name",
      "version",
      "description",
      "private",
      "type",
      "engines",
      "dependencies",
      "optionalDependencies",
      "projector",
    ],
    "Манифест плагина",
  );
  if (!isPluginPackageName(value.name)) throw new Error("Некорректное имя пакета плагина");
  assertText(value.version, "Версия плагина", 100);
  if (!semverPattern.test(value.version)) throw new Error("Версия плагина должна быть semver");
  if (value.description !== undefined) assertText(value.description, "Описание плагина", 1000);
  if (value.private !== undefined && typeof value.private !== "boolean")
    throw new Error("private должен быть boolean");
  if (value.type !== undefined && value.type !== "module")
    throw new Error("type плагина должен быть module");
  if (value.engines !== undefined) {
    assertRecord(value.engines, "engines");
    assertAllowedKeys(value.engines, ["projector"], "engines");
    if (value.engines.projector !== undefined)
      assertText(value.engines.projector, "engines.projector", 100);
    if (
      options.projectorVersion &&
      value.engines.projector &&
      !satisfiesProjectorRange(options.projectorVersion, value.engines.projector)
    )
      throw new Error("Плагин несовместим с этой версией Projector");
  }
  if (value.dependencies !== undefined) validateDependencyMap(value.dependencies, "dependencies");
  if (value.optionalDependencies !== undefined)
    validateDependencyMap(value.optionalDependencies, "optionalDependencies");
  assertRecord(value.projector, "projector");
  assertAllowedKeys(
    value.projector,
    ["apiVersion", "contributes", "server", "browser"],
    "projector",
  );
  if (value.projector.apiVersion !== pluginApiVersion)
    throw new Error("Неподдерживаемая версия API плагина");
  assertRecord(value.projector.contributes, "projector.contributes");
  const contributes = value.projector.contributes;
  assertAllowedKeys(
    contributes,
    ["themes", "agents", "balances", "http", "languages", "panels", "tabs"],
    "projector.contributes",
  );
  if (contributes.themes !== undefined && !Array.isArray(contributes.themes))
    throw new Error("projector.contributes.themes должен быть массивом");
  if (contributes.agents !== undefined && !Array.isArray(contributes.agents))
    throw new Error("projector.contributes.agents должен быть массивом");
  if (contributes.balances !== undefined && !Array.isArray(contributes.balances))
    throw new Error("projector.contributes.balances должен быть массивом");
  if (contributes.http !== undefined && !Array.isArray(contributes.http))
    throw new Error("projector.contributes.http должен быть массивом");
  const themes = contributes.themes as unknown[] | undefined;
  const agents = contributes.agents as unknown[] | undefined;
  const balances = contributes.balances as unknown[] | undefined;
  const http = contributes.http as unknown[] | undefined;
  const browserContributions = validateBrowserContributions(contributes);
  if (value.projector.server !== undefined) {
    if (!agents?.length && !balances?.length && !http?.length)
      throw new Error(
        "projector.server допустим только вместе с contributes.agents, balances или http",
      );
    assertServerEntry(value.projector.server);
  }
  if (balances?.length && value.projector.server === undefined)
    throw new Error("Вклады balances требуют projector.server");
  if (http?.length && value.projector.server === undefined)
    throw new Error("Вклады http требуют projector.server");
  if (balances && balances.length > 20)
    throw new Error("projector.contributes.balances: не более 20 видов");
  if (value.projector.browser !== undefined) assertBrowserEntry(value.projector.browser);
  if (
    !value.projector.browser &&
    (browserContributions.languages?.length ||
      browserContributions.panels?.length ||
      browserContributions.tabs?.length)
  )
    throw new Error("Вклады languages, panels и tabs требуют projector.browser");
  if (
    !themes?.length &&
    !agents?.length &&
    !balances?.length &&
    !http?.length &&
    !browserContributions.languages?.length &&
    !browserContributions.panels?.length &&
    !browserContributions.tabs?.length
  ) {
    if (themes && !agents && !balances && !http)
      throw new Error("Плагин должен содержать хотя бы одну тему");
    if (agents && !themes && !balances && !http)
      throw new Error("Плагин должен содержать хотя бы одного агента");
    if (balances && !themes && !agents && !http)
      throw new Error("Плагин должен содержать хотя бы один вид баланса");
    if (http && !themes && !agents && !balances)
      throw new Error("Плагин должен содержать хотя бы один маршрут");
    throw new Error("Плагин должен содержать хотя бы одну тему или агента");
  }
  if (themes) {
    const ids = new Set<string>();
    for (const theme of themes) {
      assertRecord(theme, "Тема плагина");
      assertAllowedKeys(
        theme,
        ["id", "title", "description", "mode", "tokens", "settings"],
        "Тема плагина",
      );
      if (typeof theme.id !== "string" || !themeIdPattern.test(theme.id))
        throw new Error("Некорректный идентификатор темы");
      if (ids.has(theme.id)) throw new Error("Повторяющийся идентификатор темы");
      ids.add(theme.id);
      assertText(theme.title, "Название темы");
      if (theme.description !== undefined) assertText(theme.description, "Описание темы", 1000);
      if (theme.mode !== "dark" && theme.mode !== "light")
        throw new Error("Некорректный режим темы");
      validateThemeSettings(theme.settings);
      assertText(theme.tokens, "Путь к токенам темы", 300);
      if (
        theme.tokens.startsWith("/") ||
        theme.tokens.startsWith("\\") ||
        /(^|[\\/])\.\.?([\\/]|$)/.test(theme.tokens) ||
        !/^[a-zA-Z0-9._/-]+\.json$/.test(theme.tokens)
      )
        throw new Error("Небезопасный путь к токенам темы");
    }
  }
  if (agents) {
    const ids = new Set<string>();
    const hasServer = value.projector.server !== undefined;
    for (const agent of agents) validateAgentContribution(agent, ids, { hasServer });
  }
  if (balances) {
    const kinds = new Set<string>();
    for (const balance of balances) validateBalanceContribution(balance, kinds);
  }
  if (http) validateHttpContributions(http);
  return value as unknown as PluginManifest;
}
