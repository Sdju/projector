import { shallowRef } from "vue";
import {
  defaultAppearance,
  defaultAppearanceFonts,
  builtinAppearance,
  effectiveAppearance,
  isAppearanceChoice,
  isBuiltinAppearance,
  normalizeSavedThemeValues,
  normalizeAppearanceFonts,
  resolveScheme,
  schemeMode,
  type AppearanceChoice,
  type AppearanceFonts,
  type AppearanceSettings,
  type ProjectAppearanceOverride,
  type ThemeId,
} from "@ai-projector/core/modules/appearance/index.ts";
import {
  themeStyleProperties,
  themeEffectProperties,
  themeEffectStyle,
  type SavedThemeValues,
  type ThemeValues,
  themeTokenNames,
  type AvailableTheme,
} from "@ai-projector/core/modules/plugins/index.ts";

/** User-global settings from `/api/appearance` (before a project override). */
const globalChoice = shallowRef<AppearanceChoice>(defaultAppearance);
const globalFonts = shallowRef<AppearanceFonts>({ ...defaultAppearanceFonts });
export const themeSettingsValues = shallowRef<SavedThemeValues>({});
/** Trusted project override while a project page is open; cleared on leave. */
const projectOverride = shallowRef<ProjectAppearanceOverride | undefined>();
let activeProjectId: string | null = null;

/** Painted colour scheme (effective: global merged with project). */
const choice = shallowRef<AppearanceChoice>(defaultAppearance);
/** Painted scheme ID; non-CSS consumers (xterm) repaint when it changes. */
export const appearanceScheme = shallowRef<ThemeId>(defaultAppearance);
/** Painted content font sizes; chat is mirrored to `--chat-fs` on <html>. */
export const appearanceFonts = shallowRef<AppearanceFonts>({ ...defaultAppearanceFonts });
const themes = shallowRef<AvailableTheme[]>([]);
let media: MediaQueryList | undefined;
let initialized = false;
let fontsLoading: Promise<AppearanceFonts> | undefined;

/** `data-appearance` is set by the bootstrap script before the app starts; nothing is fetched here. */
export function currentAppearance(): AppearanceChoice {
  const value = document.documentElement.dataset.appearance;
  return isAppearanceChoice(value) ? value : defaultAppearance;
}

export function appearanceThemes() {
  return themes;
}

export function setAppearanceThemes(value: AvailableTheme[]): AvailableTheme[] {
  themes.value = [...value];
  return themes.value;
}

export function globalAppearanceSettings(): AppearanceSettings {
  return {
    choice: globalChoice.value,
    fonts: { ...globalFonts.value },
    themeSettings: themeSettingsValues.value,
  };
}

function clearExternalTokens(root: HTMLElement) {
  for (const name of themeTokenNames) root.style.removeProperty(`--${name}`);
}

function updateMeta(scheme: ThemeId, mode?: "dark" | "light") {
  document
    .querySelector('meta[name="color-scheme"]')
    ?.setAttribute("content", schemeMode(scheme, mode));
  const root = document.documentElement;
  const background = getComputedStyle(root)
    .getPropertyValue(mode ? "--bg" : "--bg-2")
    .trim();
  if (background)
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);
}
/** Brand surfaces follow the painted scheme; the manifest chooses matching PWA icons. */
function updateBrand(mode: "dark" | "light") {
  const light = mode === "light";
  document
    .getElementById("app-favicon")
    ?.setAttribute("href", light ? "/favicon-light.svg" : "/favicon.svg");
  document
    .getElementById("app-touch-icon")
    ?.setAttribute(
      "href",
      light ? "/icons/apple-touch-icon-light.png" : "/icons/apple-touch-icon.png",
    );
  document
    .getElementById("app-manifest")
    ?.setAttribute("href", light ? "/manifest-light.webmanifest" : "/manifest.webmanifest");
  document.getElementById("app-status-bar")?.setAttribute("content", light ? "default" : "black");
}

/** Paints one colour scheme onto <html>. */
export function applyAppearance(value: AppearanceChoice): ThemeId {
  choice.value = value;
  const resolved = resolveScheme(value, media?.matches ?? false);
  const theme = themes.value.find((item) => item.id === resolved && item.tokens);
  const scheme = !theme && !isBuiltinAppearance(resolved) ? "dark" : resolved;
  const root = document.documentElement;
  clearExternalTokens(root);
  root.dataset.appearance = value;
  root.dataset.theme = scheme;
  const fields = theme?.settings ?? builtinAppearance(scheme)?.settings ?? [];
  root.toggleAttribute("data-theme-effects", fields.length > 0);
  for (const name of Object.values(themeEffectProperties)) root.style.removeProperty(name);
  for (const [name, token] of Object.entries(
    themeEffectStyle(fields, themeSettingsValues.value[scheme]),
  ))
    root.style.setProperty(name, token);
  appearanceScheme.value = scheme;
  if (theme) {
    for (const [name, token] of Object.entries(themeStyleProperties(theme.tokens)))
      root.style.setProperty(name, token);
    root.style.colorScheme = theme.mode;
  } else {
    root.style.removeProperty("color-scheme");
  }
  updateMeta(scheme, theme?.mode);
  updateBrand(schemeMode(scheme, theme?.mode));
  return scheme;
}

/** Paints content font sizes; chat updates `--chat-fs` without scaling UI chrome. */
export function applyAppearanceFonts(value: AppearanceFonts): AppearanceFonts {
  const next = normalizeAppearanceFonts(value);
  appearanceFonts.value = next;
  document.documentElement.style.setProperty("--chat-fs", `${next.chat}px`);
  return next;
}

function paintEffective(): AppearanceSettings {
  const effective = effectiveAppearance(globalAppearanceSettings(), projectOverride.value);
  applyAppearance(effective.choice);
  applyAppearanceFonts(effective.fonts);
  return effective;
}

export function setGlobalAppearanceSettings(value: {
  choice?: unknown;
  fonts?: unknown;
  themeSettings?: unknown;
  themes?: AvailableTheme[];
}) {
  if (isAppearanceChoice(value.choice)) globalChoice.value = value.choice;
  if (value.fonts !== undefined) globalFonts.value = normalizeAppearanceFonts(value.fonts);
  if (value.themeSettings !== undefined)
    themeSettingsValues.value = normalizeSavedThemeValues(value.themeSettings);
  if (value.themes) setAppearanceThemes(value.themes.filter((theme) => theme.tokens !== undefined));
  return paintEffective();
}

export function loadAppearanceFonts() {
  return (fontsLoading ??= (async () => {
    const response = await fetch("/api/appearance");
    if (!response.ok) throw new Error("Не удалось загрузить оформление");
    return setGlobalAppearanceSettings(await response.json()).fonts;
  })().catch((error) => {
    fontsLoading = undefined;
    throw error;
  }));
}

/**
 * Remembers the user's global colour scheme and repaints with the active project override.
 * Call after a successful global `/api/appearance` PUT of `choice`, or for an optimistic preview.
 */
export function setGlobalAppearanceChoice(value: AppearanceChoice): void {
  globalChoice.value = value;
  paintEffective();
}

/** Remembers global content font sizes and repaints with the active project override. */
export function setGlobalAppearanceFonts(fonts: AppearanceFonts): void {
  globalFonts.value = normalizeAppearanceFonts(fonts);
  paintEffective();
}

export async function saveThemeSettings(id: string, values: unknown): Promise<ThemeValues> {
  const response = await fetch("/api/appearance", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ themeSettings: { [id]: values } }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось сохранить настройки схемы");
  const saved = normalizeSavedThemeValues(data.themeSettings)[id];
  if (!saved) throw new Error("Сервер не вернул настройки схемы");
  themeSettingsValues.value = { ...themeSettingsValues.value, [id]: saved };
  applyAppearance(choice.value);
  return saved;
}

/** Writes a fonts patch to the global file, then repaints with any project override. */
export async function saveAppearanceFonts(
  patch: Partial<AppearanceFonts>,
): Promise<AppearanceFonts> {
  const response = await fetch("/api/appearance", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fonts: patch }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось сохранить размеры шрифта");
  const fonts = normalizeAppearanceFonts(data.fonts ?? defaultAppearanceFonts);
  if (isAppearanceChoice(data.choice)) globalChoice.value = data.choice;
  globalFonts.value = fonts;
  return paintEffective().fonts;
}

/**
 * Loads a project's `.projector/appearance.json` trust state and applies it when trusted.
 * Pass `null` when leaving a project page to fall back to the global appearance.
 */
export async function bindProjectAppearance(projectId: string | null): Promise<void> {
  activeProjectId = projectId;
  if (!projectId) {
    projectOverride.value = undefined;
    paintEffective();
    return;
  }
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/appearance`);
  if (!response.ok) {
    projectOverride.value = undefined;
    paintEffective();
    throw new Error("Не удалось загрузить оформление проекта");
  }
  const state = await response.json();
  if (activeProjectId !== projectId) return;
  projectOverride.value = state.trusted ? (state.override ?? {}) : undefined;
  paintEffective();
}

/** Re-reads the active project's appearance after trust or file edits in settings. */
export async function refreshProjectAppearance(): Promise<void> {
  if (!activeProjectId) return;
  await bindProjectAppearance(activeProjectId);
}

export function initAppearance() {
  if (initialized) return;
  initialized = true;
  choice.value = currentAppearance();
  globalChoice.value = choice.value;
  const root = document.documentElement;
  root.dataset.appearance = choice.value;
  media = window.matchMedia("(prefers-color-scheme: light)");
  root.dataset.theme ??= resolveScheme(choice.value, media.matches);
  appearanceScheme.value = root.dataset.theme as ThemeId;
  updateBrand(getComputedStyle(root).colorScheme.includes("light") ? "light" : "dark");
  if (!root.style.getPropertyValue("--chat-fs"))
    root.style.setProperty("--chat-fs", `${appearanceFonts.value.chat}px`);
  media.addEventListener("change", () => {
    if (choice.value === "auto" || globalChoice.value === "auto") paintEffective();
  });
  void loadAppearanceFonts().catch(() => undefined);
}
