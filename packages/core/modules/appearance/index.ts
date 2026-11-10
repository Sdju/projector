import { isExternalThemeId } from "../plugins/index.ts";

/** Встроенная схема или namespaced ID темы из включённого плагина. */
export type ThemeId = ColorScheme | (string & {});
export type ColorScheme = "dark" | "light" | "contrast";

/** Режим нативных контролов и scrollbar: у контрастной схемы он тёмный. */
export type ColorMode = "dark" | "light";

/** Выбор пользователя: конкретная схема или следование системной теме. */
export type AppearanceChoice = ThemeId | "auto";

export const appearanceFile = "appearance.json";

export const appearanceOptions = [
  {
    id: "dark",
    title: "Тёмная",
    description: "Спокойная тёплая тёмная схема Projector.",
    mode: "dark",
  },
  {
    id: "light",
    title: "Светлая",
    description: "Тёплая светлая схема для яркого окружения.",
    mode: "light",
  },
  {
    id: "contrast",
    title: "Высокий контраст",
    description: "Чёрный фон и яркие акценты для максимальной читаемости.",
    mode: "dark",
  },
  {
    id: "auto",
    title: "Как в системе",
    description: "Следует за светлой или тёмной темой операционной системы.",
  },
] as const satisfies readonly {
  id: AppearanceChoice;
  title: string;
  description: string;
  mode?: ColorMode;
}[];

export const defaultAppearance: AppearanceChoice = "dark";

export function isAppearanceChoice(value: unknown): value is AppearanceChoice {
  return appearanceOptions.some((option) => option.id === value) || isExternalThemeId(value);
}

export function resolveScheme(choice: AppearanceChoice, prefersLight: boolean): ThemeId {
  if (choice === "auto") return prefersLight ? "light" : "dark";
  return choice;
}

export function schemeMode(scheme: ThemeId, externalMode?: ColorMode): ColorMode {
  if (scheme === "light") return "light";
  if (scheme === "dark" || scheme === "contrast") return "dark";
  return externalMode ?? "dark";
}
