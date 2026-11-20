import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  validateThemeTokens,
  validateThemeSettings,
  type AvailableTheme,
  type ThemeTokens,
} from "@ai-projector/core/modules/plugins/index.ts";

const maxThemeBytes = 64 * 1024;
const maxThemes = 50;
const themeName = /^[a-z0-9][a-z0-9._-]*$/;
const themeExtension = /\.(json|css)$/i;

/** User-supplied colour schemes live beside the rest of the Projector data. */
export function userThemesDirectory(): string {
  return join(dataDir(), "themes");
}

function themeId(file: string): string | undefined {
  const name = basename(file).replace(themeExtension, "").toLowerCase();
  return themeName.test(name) ? `user/${name}` : undefined;
}

function luminance(hex: string): number | undefined {
  if (!/^#[\da-f]{6}$/i.test(hex)) return undefined;
  const [r, g, b] = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function inferMode(tokens: ThemeTokens): "dark" | "light" {
  const value = luminance(tokens.bg);
  return value !== undefined && value > 0.35 ? "light" : "dark";
}

function metadata(text: string, field: "title" | "description" | "mode") {
  return text.match(new RegExp(`/\\*\\s*${field}\\s*:\\s*(.+?)\\s*\\*/`, "i"))?.[1].trim();
}

function titleOf(id: string, value?: string): string {
  const title = value?.trim().slice(0, 200);
  return title || id.slice("user/".length);
}

function descriptionOf(value?: string): string | undefined {
  const description = value?.trim().slice(0, 1000);
  return description || undefined;
}

function jsonTheme(id: string, text: string): AvailableTheme {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Ожидался объект");
  const tokens = validateThemeTokens(raw.tokens);
  const settings = validateThemeSettings(raw.settings);
  const mode = raw.mode === "light" || raw.mode === "dark" ? raw.mode : inferMode(tokens);
  const description = descriptionOf(
    typeof raw.description === "string" ? raw.description : undefined,
  );
  return {
    id,
    packageName: "user",
    source: "file",
    title: titleOf(id, typeof raw.title === "string" ? raw.title : undefined),
    ...(description ? { description } : {}),
    mode,
    tokens,
    ...(settings ? { settings } : {}),
  };
}

function cssTheme(id: string, text: string): AvailableTheme {
  const title = metadata(text, "title");
  const description = metadata(text, "description");
  const declaredMode = metadata(text, "mode");
  const body = text.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  const block = body.match(/^:root\s*\{([\s\S]*)\}$/i);
  const declarations = (block ? block[1] : body).trim();
  if (!declarations || /[{}@]/.test(declarations))
    throw new Error("Ожидались только объявления --токенов внутри :root");
  const raw: Record<string, string> = {};
  for (const declaration of declarations.split(";")) {
    const item = declaration.trim();
    if (!item) continue;
    const match = item.match(/^(--[a-zA-Z0-9-]+)\s*:\s*(.+)$/s);
    if (!match) throw new Error("Ожидались только объявления --токенов");
    raw[match[1].slice(2)] = match[2].trim();
  }
  const tokens = validateThemeTokens(raw);
  const mode =
    declaredMode === "light" || declaredMode === "dark" ? declaredMode : inferMode(tokens);
  const summary = descriptionOf(description);
  return {
    id,
    packageName: "user",
    source: "file",
    title: titleOf(id, title),
    ...(summary ? { description: summary } : {}),
    mode,
    tokens,
  };
}

async function readTheme(path: string): Promise<AvailableTheme | undefined> {
  const info = await stat(path);
  if (!info.isFile() || info.size > maxThemeBytes) return undefined;
  const id = themeId(path);
  if (!id) return undefined;
  const text = await readFile(path, "utf8");
  return path.toLowerCase().endsWith(".css") ? cssTheme(id, text) : jsonTheme(id, text);
}

/** Reads `themes/*.json` and `themes/*.css`; bad files are skipped instead of breaking appearance. */
export async function discoverUserThemes(): Promise<AvailableTheme[]> {
  const directory = userThemesDirectory();
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const themes: AvailableTheme[] = [];
  const seen = new Set<string>();
  for (const entry of entries
    .filter((item) => item.isFile() && themeExtension.test(item.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, maxThemes)) {
    try {
      const theme = await readTheme(join(directory, entry.name));
      if (!theme || seen.has(theme.id)) continue;
      seen.add(theme.id);
      themes.push(theme);
    } catch (error) {
      console.warn(`User theme ${entry.name}:`, error);
    }
  }
  return themes.sort((left, right) => left.title.localeCompare(right.title, "ru"));
}

export async function findUserTheme(id: string): Promise<AvailableTheme | undefined> {
  return (await discoverUserThemes()).find((theme) => theme.id === id);
}
