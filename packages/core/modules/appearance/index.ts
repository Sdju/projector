/** Идентификатор схемы применяется как `data-theme` на `<html>`. */
export type ColorScheme = "dark" | "light";

/** Выбор пользователя: конкретная схема или следование системной теме. */
export type AppearanceChoice = ColorScheme | "auto";

export const appearanceFile = "appearance.json";

export const appearanceOptions = [
  {
    id: "dark",
    title: "Тёмная",
    description: "Спокойная тёплая тёмная схема Projector.",
  },
  {
    id: "light",
    title: "Светлая",
    description: "Тёплая светлая схема для яркого окружения.",
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
}[];

export const defaultAppearance: AppearanceChoice = "dark";

export function isAppearanceChoice(value: unknown): value is AppearanceChoice {
  return appearanceOptions.some((option) => option.id === value);
}

export function resolveScheme(choice: AppearanceChoice, prefersLight: boolean): ColorScheme {
  if (choice === "auto") return prefersLight ? "light" : "dark";
  return choice;
}
