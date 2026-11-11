import { shallowRef } from "vue";
import {
  defaultAppearance,
  isAppearanceChoice,
  resolveScheme,
  schemeMode,
  type AppearanceChoice,
  type ThemeId,
} from "@ai-projector/core/modules/appearance/index.ts";
import {
  themeStyleProperties,
  themeTokenNames,
  type AvailableTheme,
} from "@ai-projector/core/modules/plugins/index.ts";

const choice = shallowRef<AppearanceChoice>(defaultAppearance);
const themes = shallowRef<AvailableTheme[]>([]);
let media: MediaQueryList | undefined;
let initialized = false;

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

/** Applies immediately: every component reads colours from the tokens on <html>. */
export function applyAppearance(value: AppearanceChoice): ThemeId {
  choice.value = value;
  const resolved = resolveScheme(value, media?.matches ?? false);
  const theme = themes.value.find((item) => item.id === resolved && item.tokens);
  const scheme = !theme && !["dark", "light", "contrast"].includes(resolved) ? "dark" : resolved;
  const root = document.documentElement;
  clearExternalTokens(root);
  root.dataset.appearance = value;
  root.dataset.theme = scheme;
  if (theme) {
    for (const [name, token] of Object.entries(themeStyleProperties(theme.tokens)))
      root.style.setProperty(name, token);
    root.style.colorScheme = theme.mode;
  } else {
    root.style.removeProperty("color-scheme");
  }
  updateMeta(scheme, theme?.mode);
  return scheme;
}

export function initAppearance() {
  if (initialized) return;
  initialized = true;
  choice.value = currentAppearance();
  const root = document.documentElement;
  root.dataset.appearance = choice.value;
  root.dataset.theme ??= resolveScheme(
    choice.value,
    window.matchMedia("(prefers-color-scheme: light)").matches,
  );
  media = window.matchMedia("(prefers-color-scheme: light)");
  media.addEventListener("change", () => {
    if (choice.value === "auto") applyAppearance("auto");
  });
}
