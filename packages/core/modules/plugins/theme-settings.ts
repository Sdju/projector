import { assertAllowedKeys, assertRecord, assertText } from "./agent.ts";

type Field = { id: string; title: string; hint?: string };
export type ThemeSetting =
  | (Field & { kind: "wallpaper"; default: string })
  | (Field & { kind: "blur"; default: number; min: number; max: number });
export type ThemeValues = Record<string, string | number>;
export type SavedThemeValues = Record<string, ThemeValues>;

export const themeEffectProperties = {
  wallpaper: "--theme-wallpaper",
  blur: "--theme-backdrop",
} as const;

export function validateThemeSettings(value: unknown): ThemeSetting[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > Object.keys(themeEffectProperties).length)
    throw new Error("Некорректный список настроек темы");
  const ids = new Set<string>();
  const kinds = new Set<string>();
  return value.map((field) => {
    assertRecord(field, "Настройка темы");
    assertAllowedKeys(
      field,
      ["id", "title", "hint", "kind", "default", ...(field.kind === "blur" ? ["min", "max"] : [])],
      "Настройка темы",
    );
    if (
      typeof field.id !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(field.id) ||
      ids.has(field.id)
    )
      throw new Error("Некорректный идентификатор настройки темы");
    assertText(field.title, "Название настройки темы", 200);
    if (field.hint !== undefined) assertText(field.hint, "Подсказка настройки темы", 1000);
    if ((field.kind !== "wallpaper" && field.kind !== "blur") || kinds.has(field.kind))
      throw new Error("Некорректный тип настройки темы");
    if (field.kind === "blur") {
      const { min, max } = field;
      if (
        typeof min !== "number" ||
        typeof max !== "number" ||
        !Number.isInteger(min) ||
        !Number.isInteger(max) ||
        min < 0 ||
        max > 64 ||
        min >= max
      )
        throw new Error("Некорректный диапазон размытия");
    }
    const schema = field as ThemeSetting;
    const initial = normalizeValue(schema, field.default);
    if (schema.kind === "blur" && initial !== schema.default)
      throw new Error("Некорректное значение размытия по умолчанию");
    ids.add(schema.id);
    kinds.add(schema.kind);
    return schema.kind === "wallpaper" ? { ...schema, default: String(initial) } : schema;
  });
}

function normalizeValue(field: ThemeSetting, value: unknown): string | number {
  if (field.kind === "blur") {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error("Укажите размытие в пикселях");
    return Math.min(field.max, Math.max(field.min, Math.round(value)));
  }
  if (typeof value !== "string" || value.length > 4096)
    throw new Error("Укажите ссылку на изображение длиной до 4096 символов");
  const url = value.trim();
  if (!url) return "";
  const parsed = URL.parse(url);
  if (
    !parsed ||
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new Error("Укажите HTTP(S)-ссылку на изображение без логина и пароля");
  return parsed.href;
}

export function resolveThemeValues(
  fields: readonly ThemeSetting[],
  saved?: ThemeValues,
): ThemeValues {
  return Object.fromEntries(
    fields.map((field) => {
      try {
        return [
          field.id,
          saved && Object.hasOwn(saved, field.id)
            ? normalizeValue(field, saved[field.id])
            : field.default,
        ];
      } catch {
        return [field.id, field.default];
      }
    }),
  );
}

export function mergeThemeValues(
  fields: readonly ThemeSetting[],
  saved: ThemeValues | undefined,
  patch: unknown,
): ThemeValues {
  assertRecord(patch, "Значения настроек темы");
  assertAllowedKeys(
    patch,
    fields.map(({ id }) => id),
    "Значения настроек темы",
  );
  return {
    ...resolveThemeValues(fields, saved),
    ...Object.fromEntries(
      fields
        .filter(({ id }) => Object.hasOwn(patch, id))
        .map((field) => [field.id, normalizeValue(field, patch[field.id])]),
    ),
  };
}

export function themeEffectStyle(
  fields: readonly ThemeSetting[],
  saved?: ThemeValues,
): Record<string, string> {
  const values = resolveThemeValues(fields, saved);
  return Object.fromEntries(
    fields.map((field) => {
      const value = values[field.id];
      const css = !value
        ? "none"
        : field.kind === "wallpaper"
          ? `url(${JSON.stringify(value)})`
          : `blur(${value}px)`;
      return [themeEffectProperties[field.kind], css];
    }),
  );
}
