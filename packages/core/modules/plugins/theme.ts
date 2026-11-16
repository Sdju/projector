import { assertAllowedKeys, assertRecord } from "./agent.ts";

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

export interface AvailableTheme {
  id: string;
  packageName: string;
  title: string;
  description?: string;
  mode: "dark" | "light";
  tokens: ThemeTokens;
}

const optionalTokens = new Set<ThemeTokenName>(["hover", "active"]);
const hexPattern = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const functionalColorPattern = /^(?:rgba?|hsla?)\([0-9.%+\-,\s/]+\)$/i;
const colorMixPattern = /^color-mix\(in (?:srgb|srgb-linear|hsl|hwb|lab|lch|oklab|oklch),\s*.+\)$/i;
const shadowPattern = /^0 \d+(?:\.\d+)?px \d+(?:\.\d+)?px #[0-9a-f]{3,8}$/i;

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
