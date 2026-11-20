import { assertAllowedKeys, assertRecord, assertText } from "./agent.ts";

type Field = { id: string; title: string; hint?: string };
export type ThemeSeedOption = { id: string; title: string; color: string };
export type ThemeSetting =
  | (Field & { kind: "wallpaper"; default: string })
  | (Field & { kind: "blur"; default: number; min: number; max: number })
  | (Field & { kind: "seed"; default: string; options: readonly ThemeSeedOption[] });
export type ThemeValues = Record<string, string | number>;
export type SavedThemeValues = Record<string, ThemeValues>;

const themeSettingKinds = ["wallpaper", "blur", "seed"] as const;

export const themeEffectProperties = {
  wallpaper: "--theme-wallpaper",
  blur: "--theme-backdrop",
} as const;

const hexColor = /^#[0-9a-f]{6}$/i;
const seedId = /^[a-z][a-z0-9-]{0,31}$/;

export function validateThemeSettings(value: unknown): ThemeSetting[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > themeSettingKinds.length)
    throw new Error("Некорректный список настроек темы");
  const ids = new Set<string>();
  const kinds = new Set<string>();
  return value.map((field) => {
    assertRecord(field, "Настройка темы");
    assertAllowedKeys(
      field,
      [
        "id",
        "title",
        "hint",
        "kind",
        "default",
        ...(field.kind === "blur" ? ["min", "max"] : field.kind === "seed" ? ["options"] : []),
      ],
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
    if (
      (field.kind !== "wallpaper" && field.kind !== "blur" && field.kind !== "seed") ||
      kinds.has(field.kind)
    )
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
    if (field.kind === "seed") {
      if (!Array.isArray(field.options) || field.options.length < 2 || field.options.length > 8)
        throw new Error("Некорректный список опорных цветов");
      const optionIds = new Set<string>();
      for (const option of field.options) {
        assertRecord(option, "Опорный цвет");
        assertAllowedKeys(option, ["id", "title", "color"], "Опорный цвет");
        if (typeof option.id !== "string" || !seedId.test(option.id) || optionIds.has(option.id))
          throw new Error("Некорректный идентификатор опорного цвета");
        assertText(option.title, "Название опорного цвета", 80);
        if (typeof option.color !== "string" || !hexColor.test(option.color))
          throw new Error("Некорректный опорный цвет");
        optionIds.add(option.id);
      }
    }
    const schema = field as ThemeSetting;
    const initial = normalizeValue(schema, field.default);
    if (schema.kind !== "wallpaper" && initial !== schema.default)
      throw new Error(
        schema.kind === "blur"
          ? "Некорректное значение размытия по умолчанию"
          : "Некорректный опорный цвет по умолчанию",
      );
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
  if (field.kind === "seed") {
    if (typeof value !== "string" || !field.options.some((option) => option.id === value))
      throw new Error("Выберите опорный цвет");
    return value;
  }
  if (typeof value !== "string" || value.length > 4096)
    throw new Error("Укажите ссылку на изображение длиной до 4096 символов");
  const url = value.trim();
  if (!url) return "";
  if (url === "/api/appearance/wallpaper") return url;
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
    fields.flatMap((field) => {
      if (field.kind !== "wallpaper" && field.kind !== "blur") return [];
      const value = values[field.id];
      const css = !value
        ? "none"
        : field.kind === "wallpaper"
          ? `url(${JSON.stringify(value)})`
          : `blur(${value}px)`;
      return [[themeEffectProperties[field.kind], css]];
    }),
  );
}
