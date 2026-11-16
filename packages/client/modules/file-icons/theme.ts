import { readonly, shallowRef, ref, watch } from "vue";
import defaults from "./fallback-theme.json";
import {
  createFileIconResolver,
  fileIconThemeSchema,
} from "@ai-projector/core/modules/file-icons/index.ts";
import { appearanceScheme } from "../appearance/index.ts";

const resolver = shallowRef(createFileIconResolver(defaults));
const error = ref("");
let pending: Promise<void> | undefined;
let palette: Record<string, string> = defaults.palette;
let lightPalette: Record<string, string> = defaults.paletteLight ?? {};
const painted = new Set<string>();

/** Palette colours become CSS variables so FileIcon follows the painted scheme. */
function paintPalette() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const light = getComputedStyle(root).colorScheme.includes("light");
  for (const name of painted) root.style.removeProperty(`--file-icon-${name}`);
  painted.clear();
  for (const [name, value] of Object.entries(palette)) {
    if (!/^[\w-]+$/.test(name)) continue;
    root.style.setProperty(`--file-icon-${name}`, light ? (lightPalette[name] ?? value) : value);
    painted.add(name);
  }
}
paintPalette();
watch(appearanceScheme, paintPalette, { flush: "post" });

/** Runtime JSON can be edited in public/ (dev) or dist/ (built app), without rebuilding. */
export function reloadFileIconTheme() {
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch("/file-icons/theme.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const theme = fileIconThemeSchema.parse(await response.json());
      resolver.value = createFileIconResolver(theme);
      palette = theme.palette;
      lightPalette = theme.paletteLight ?? {};
      paintPalette();
      error.value = "";
    } catch (cause) {
      // Keep the last valid theme, including bundled defaults on first load.
      error.value = "Не удалось загрузить тему иконок. Используется предыдущая тема.";
      console.warn("File icon theme:", cause);
    } finally {
      pending = undefined;
    }
  })();
  return pending;
}

let initialized = false;
export function useFileIconTheme() {
  if (!initialized) {
    initialized = true;
    void reloadFileIconTheme();
  }
  return { resolver: readonly(resolver), error: readonly(error) };
}
