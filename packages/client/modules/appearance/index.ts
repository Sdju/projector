import { shallowRef } from "vue";
import {
  defaultAppearance,
  isAppearanceChoice,
  resolveScheme,
  schemeMode,
  type AppearanceChoice,
  type ColorScheme,
} from "@projector-ai/core/modules/appearance/index.ts";

const choice = shallowRef<AppearanceChoice>(defaultAppearance);
let media: MediaQueryList | undefined;
let initialized = false;

/** `data-appearance` is set by the bootstrap script before the app starts; nothing is fetched here. */
export function currentAppearance(): AppearanceChoice {
  const value = document.documentElement.dataset.appearance;
  return isAppearanceChoice(value) ? value : defaultAppearance;
}

function updateMeta(scheme: ColorScheme) {
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", schemeMode(scheme));
  const background = getComputedStyle(document.documentElement).getPropertyValue("--bg-2").trim();
  if (background)
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);
}

/** Applies immediately: every component reads colours from the tokens on <html>. */
export function applyAppearance(value: AppearanceChoice): ColorScheme {
  choice.value = value;
  const scheme = resolveScheme(value, media?.matches ?? false);
  const root = document.documentElement;
  root.dataset.appearance = value;
  root.dataset.theme = scheme;
  updateMeta(scheme);
  return scheme;
}

export function initAppearance() {
  if (initialized) return;
  initialized = true;
  applyAppearance(currentAppearance());
  media = window.matchMedia("(prefers-color-scheme: light)");
  media.addEventListener("change", () => {
    if (choice.value === "auto") applyAppearance("auto");
  });
}
