import {
  isExternalThemeId,
  type SavedThemeValues,
  type ThemeSetting,
  type ThemeValues,
} from "../plugins/index.ts";
import { frozenGlass, frozenGlassStyle } from "./frozen-glass.ts";
export {
  frozenGlass,
  frozenGlassOverlayProperties,
  frozenGlassPalette,
  frozenGlassSeeds,
  frozenGlassStyle,
} from "./frozen-glass.ts";
export { hctFromHex, hexFromHct, hueDistance } from "./hct.ts";

export function themePaletteStyle(scheme: string, saved?: ThemeValues): Record<string, string> {
  return scheme === frozenGlass.id ? frozenGlassStyle(saved) : {};
}

/** Встроенная схема или namespaced ID темы из включённого плагина. */
export type ThemeId = ColorScheme | (string & {});
export type ColorScheme = Exclude<(typeof appearanceOptions)[number]["id"], "auto">;

/** Режим нативных контролов и scrollbar: у контрастной схемы он тёмный. */
export type ColorMode = "dark" | "light";

/** Выбор пользователя: конкретная схема или следование системной теме. */
export type AppearanceChoice = ThemeId | "auto";

/** Content font sizes in px — chat, editor and terminal, not UI chrome scale. */
export type AppearanceFonts = {
  chat: number;
  editor: number;
  terminal: number;
};

export type AppearanceFontKey = keyof AppearanceFonts;

/** Saved appearance on disk: colour scheme plus content font sizes. */
export type AppearanceSettings = {
  choice: AppearanceChoice;
  fonts: AppearanceFonts;
  themeSettings: SavedThemeValues;
};

export const appearanceFile = "appearance.json";
/** Legacy file from the short-lived typography settings; read once into appearance. */
export const legacyTypographyFile = "typography.json";

export const appearanceOptions = [
  {
    id: "dark",
    title: "Тёмная",
    description: "Спокойная тёплая тёмная схема Projector.",
    mode: "dark",
    themeColor: "#171716",
  },
  {
    id: "light",
    title: "Светлая",
    description: "Тёплая светлая схема для яркого окружения.",
    mode: "light",
    themeColor: "#efeee8",
  },
  {
    id: "contrast",
    title: "Высокий контраст",
    description: "Чёрный фон и яркие акценты для максимальной читаемости.",
    mode: "dark",
    themeColor: "#080808",
  },
  frozenGlass,
  {
    id: "auto",
    title: "Как в системе",
    description: "Следует за светлой или тёмной темой операционной системы.",
  },
] as const satisfies readonly {
  id: string;
  title: string;
  description: string;
  mode?: ColorMode;
  themeColor?: string;
  settings?: readonly ThemeSetting[];
}[];

export const defaultAppearance: AppearanceChoice = "dark";

/** Default matches the previous hard-coded 13px of chat, CodeMirror and xterm. */
export const defaultAppearanceFonts: AppearanceFonts = {
  chat: 13,
  editor: 13,
  terminal: 13,
};

export const appearanceFontMin = 11;
export const appearanceFontMax = 20;

export function isAppearanceChoice(value: unknown): value is AppearanceChoice {
  return isBuiltinAppearance(value) || isExternalThemeId(value);
}

export function isBuiltinAppearance(value: unknown): value is ColorScheme | "auto" {
  return appearanceOptions.some((option) => option.id === value);
}

export function resolveScheme(choice: AppearanceChoice, prefersLight: boolean): ThemeId {
  if (choice === "auto") return prefersLight ? "light" : "dark";
  return choice;
}

export function schemeMode(scheme: ThemeId, externalMode?: ColorMode): ColorMode {
  return builtinAppearance(scheme)?.mode ?? externalMode ?? "dark";
}

export function clampAppearanceFont(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(appearanceFontMax, Math.max(appearanceFontMin, Math.round(value)));
}

export function normalizeAppearanceFonts(value: unknown): AppearanceFonts {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    chat: clampAppearanceFont(raw.chat, defaultAppearanceFonts.chat),
    editor: clampAppearanceFont(raw.editor, defaultAppearanceFonts.editor),
    terminal: clampAppearanceFont(raw.terminal, defaultAppearanceFonts.terminal),
  };
}

/** Keeps unset keys; only provided fields are clamped. */
export function mergeAppearanceFonts(current: AppearanceFonts, patch: unknown): AppearanceFonts {
  const raw = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {};
  return {
    chat: raw.chat !== undefined ? clampAppearanceFont(raw.chat, current.chat) : current.chat,
    editor:
      raw.editor !== undefined ? clampAppearanceFont(raw.editor, current.editor) : current.editor,
    terminal:
      raw.terminal !== undefined
        ? clampAppearanceFont(raw.terminal, current.terminal)
        : current.terminal,
  };
}

export function builtinAppearance(id: string):
  | {
      id: ColorScheme | "auto";
      mode?: ColorMode;
      themeColor?: string;
      settings?: readonly ThemeSetting[];
    }
  | undefined {
  return appearanceOptions.find((option) => option.id === id);
}

export function normalizeSavedThemeValues(value: unknown): SavedThemeValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, fields]) => {
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) return [];
      return [
        [
          id,
          Object.fromEntries(
            Object.entries(fields).filter(
              (pair): pair is [string, string | number] =>
                typeof pair[1] === "string" ||
                (typeof pair[1] === "number" && Number.isFinite(pair[1])),
            ),
          ),
        ],
      ];
    }),
  );
}

export function normalizeAppearance(value: unknown): AppearanceSettings {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const legacy = appearanceOptions.flatMap((theme) =>
    "legacySettingsKey" in theme ? [[theme.id, raw[theme.legacySettingsKey]]] : [],
  );
  return {
    choice: isAppearanceChoice(raw.choice) ? raw.choice : defaultAppearance,
    fonts: normalizeAppearanceFonts(raw.fonts),
    themeSettings: normalizeSavedThemeValues(raw.themeSettings ?? Object.fromEntries(legacy)),
  };
}

/**
 * Partial override from a project's `.projector/appearance.json`.
 * Omitted fields inherit the user's global appearance.
 */
export type ProjectAppearanceOverride = {
  choice?: AppearanceChoice;
  fonts?: Partial<AppearanceFonts>;
};

/** Project appearance file state returned to settings and trust UI. */
export type ProjectAppearanceState = {
  projectId: string;
  path: string;
  file: string;
  exists: boolean;
  trusted: boolean;
  hash?: string;
  override: ProjectAppearanceOverride;
  problem?: string;
};

/** Reads only explicitly set fields; missing keys stay inherited, not defaulted. */
export function normalizeProjectAppearanceOverride(value: unknown): ProjectAppearanceOverride {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const override: ProjectAppearanceOverride = {};
  if (isAppearanceChoice(raw.choice)) override.choice = raw.choice;
  if (raw.fonts && typeof raw.fonts === "object" && !Array.isArray(raw.fonts)) {
    const fonts: Partial<AppearanceFonts> = {};
    const source = raw.fonts as Record<string, unknown>;
    for (const key of ["chat", "editor", "terminal"] as const) {
      if (source[key] === undefined) continue;
      fonts[key] = clampAppearanceFont(source[key], defaultAppearanceFonts[key]);
    }
    if (Object.keys(fonts).length) override.fonts = fonts;
  }
  return override;
}

/** Global settings with a trusted project override on top. */
export function effectiveAppearance(
  global: AppearanceSettings,
  override: ProjectAppearanceOverride | undefined,
): AppearanceSettings {
  if (!override) return global;
  return {
    ...global,
    choice: override.choice ?? global.choice,
    fonts: mergeAppearanceFonts(global.fonts, override.fonts ?? {}),
  };
}
