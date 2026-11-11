import {
  assertAllowedKeys,
  assertRecord,
  assertText,
  validateAgentContribution,
  type PluginAgentContribution,
} from "./agent.ts";

export type {
  PluginAgentContribution,
  PluginAgentTerminal,
  PluginAgentUsageCommand,
} from "./agent.ts";
export { isPluginIconFile, sanitizePluginIconSvg } from "./icon.ts";

export const pluginApiVersion = 1;

export const themeTokenNames = [
  "bg",
  "bg-2",
  "bg-3",
  "bg-4",
  "bg-sunken",
  "canvas",
  "line",
  "line-strong",
  "text",
  "text-2",
  "muted",
  "faint",
  "focus",
  "accent",
  "run",
  "err",
  "warn",
  "info",
  "search",
  "hover",
  "active",
  "selection",
  "overlay",
  "shadow-popover",
  "shadow-modal",
] as const;

export type ThemeTokenName = (typeof themeTokenNames)[number];
export type ThemeTokens = {
  [Name in Exclude<ThemeTokenName, "hover" | "active">]: string;
} & {
  [Name in Extract<ThemeTokenName, "hover" | "active">]?: string;
};

export interface PluginThemeContribution {
  id: string;
  title: string;
  description?: string;
  mode: "dark" | "light";
  tokens: string;
}

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  engines?: { projector?: string };
  projector: {
    apiVersion: typeof pluginApiVersion;
    /**
     * Server-side code entry inside the package, relative and never outside it.
     * The file runs in the Projector server process, so enabling it requires explicit user trust.
     */
    server?: string;
    contributes: {
      themes?: PluginThemeContribution[];
      agents?: PluginAgentContribution[];
    };
  };
}

export interface AvailableTheme {
  id: string;
  packageName: string;
  title: string;
  description?: string;
  mode: "dark" | "light";
  tokens: ThemeTokens;
}

export interface PluginValidationOptions {
  projectorVersion?: string;
}

const optionalTokens = new Set<ThemeTokenName>(["hover", "active"]);
const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/;
const themeIdPattern = /^[a-z0-9][a-z0-9._-]*$/;
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const hexPattern = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const functionalColorPattern = /^(?:rgba?|hsla?)\([0-9.%+\-,\s/]+\)$/i;
const colorMixPattern = /^color-mix\(in (?:srgb|srgb-linear|hsl|hwb|lab|lch|oklab|oklch),\s*.+\)$/i;
const shadowPattern = /^0 \d+(?:\.\d+)?px \d+(?:\.\d+)?px #[0-9a-f]{3,8}$/i;

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

export function validateThemeTokens(value: unknown): ThemeTokens {
  assertRecord(value, "Токены темы");
  assertAllowedKeys(value, themeTokenNames, "Токены темы");
  for (const name of themeTokenNames) {
    const token = value[name];
    if (token === undefined && optionalTokens.has(name)) continue;
    if (typeof token !== "string" || !token) throw new Error(`Токен --${name} обязателен`);
    if (/url\s*\(|javascript\s*:|[{};]/i.test(token))
      throw new Error(`Недопустимое значение токена --${name}`);
    const valid =
      name === "shadow-popover" || name === "shadow-modal"
        ? shadowPattern.test(token)
        : hexPattern.test(token) ||
          functionalColorPattern.test(token) ||
          (colorMixPattern.test(token) &&
            (!token.includes("var(") ||
              (optionalTokens.has(name) &&
                /^color-mix\(in srgb, var\(--text\) \d+(?:\.\d+)?%, transparent\)$/.test(token))));
    if (!valid) throw new Error(`Недопустимое значение токена --${name}`);
  }
  return { ...value } as ThemeTokens;
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

export function validatePluginManifest(
  value: unknown,
  options: PluginValidationOptions = {},
): PluginManifest {
  assertRecord(value, "Манифест плагина");
  assertAllowedKeys(
    value,
    ["name", "version", "description", "private", "type", "engines", "projector"],
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
  assertRecord(value.projector, "projector");
  assertAllowedKeys(value.projector, ["apiVersion", "contributes", "server"], "projector");
  if (value.projector.apiVersion !== pluginApiVersion)
    throw new Error("Неподдерживаемая версия API плагина");
  assertRecord(value.projector.contributes, "projector.contributes");
  const contributes = value.projector.contributes;
  assertAllowedKeys(contributes, ["themes", "agents"], "projector.contributes");
  if (contributes.themes !== undefined && !Array.isArray(contributes.themes))
    throw new Error("projector.contributes.themes должен быть массивом");
  if (contributes.agents !== undefined && !Array.isArray(contributes.agents))
    throw new Error("projector.contributes.agents должен быть массивом");
  const themes = contributes.themes as unknown[] | undefined;
  const agents = contributes.agents as unknown[] | undefined;
  if (value.projector.server !== undefined) {
    if (!agents?.length)
      throw new Error("projector.server допустим только вместе с contributes.agents");
    assertServerEntry(value.projector.server);
  }
  if (!themes?.length && !agents?.length) {
    if (themes && !agents) throw new Error("Плагин должен содержать хотя бы одну тему");
    if (agents && !themes) throw new Error("Плагин должен содержать хотя бы одного агента");
    throw new Error("Плагин должен содержать хотя бы одну тему или агента");
  }
  if (themes) {
    const ids = new Set<string>();
    for (const theme of themes) {
      assertRecord(theme, "Тема плагина");
      assertAllowedKeys(theme, ["id", "title", "description", "mode", "tokens"], "Тема плагина");
      if (typeof theme.id !== "string" || !themeIdPattern.test(theme.id))
        throw new Error("Некорректный идентификатор темы");
      if (ids.has(theme.id)) throw new Error("Повторяющийся идентификатор темы");
      ids.add(theme.id);
      assertText(theme.title, "Название темы");
      if (theme.description !== undefined) assertText(theme.description, "Описание темы", 1000);
      if (theme.mode !== "dark" && theme.mode !== "light")
        throw new Error("Некорректный режим темы");
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
    for (const agent of agents) validateAgentContribution(agent, ids);
  }
  return value as unknown as PluginManifest;
}

export function themeStyleProperties(
  tokens: ThemeTokens,
): Partial<Record<`--${ThemeTokenName}`, string>> {
  return Object.fromEntries(
    themeTokenNames.flatMap((name) => (tokens[name] ? [[`--${name}`, tokens[name]]] : [])),
  ) as Partial<Record<`--${ThemeTokenName}`, string>>;
}

export function serializeThemeTokens(tokens: ThemeTokens): string {
  return Object.entries(themeStyleProperties(tokens))
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
}
