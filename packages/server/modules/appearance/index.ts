import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  appearanceFile,
  defaultAppearance,
  defaultAppearanceFonts,
  builtinAppearance,
  isAppearanceChoice,
  isBuiltinAppearance,
  legacyTypographyFile,
  mergeAppearanceFonts,
  normalizeAppearance,
  normalizeAppearanceFonts,
  type AppearanceChoice,
  type AppearanceFonts,
  type AppearanceSettings,
} from "@ai-projector/core/modules/appearance/index.ts";
import { mergeThemeValues, type AvailableTheme } from "@ai-projector/core/modules/plugins/index.ts";
import { writeFileAtomic, withFileLock } from "../atomic-files/index.ts";

export { discoverUserThemes, findUserTheme, userThemesDirectory } from "./user-themes.ts";

const appearancePath = () => join(dataDir(), appearanceFile);
const legacyTypographyPath = () => join(dataDir(), legacyTypographyFile);

async function readLegacyTypography(): Promise<AppearanceFonts | undefined> {
  try {
    return normalizeAppearanceFonts(JSON.parse(await readFile(legacyTypographyPath(), "utf8")));
  } catch {
    return undefined;
  }
}

export async function readAppearance(): Promise<AppearanceSettings> {
  try {
    const data = JSON.parse(await readFile(appearancePath(), "utf8"));
    const settings = normalizeAppearance(data);
    if (data?.fonts !== undefined) return settings;
    const legacy = await readLegacyTypography();
    return legacy ? { ...settings, fonts: legacy } : settings;
  } catch {
    // Appearance is cosmetic: a missing, damaged or unreadable file must not block the app.
    const legacy = await readLegacyTypography();
    return {
      choice: defaultAppearance,
      fonts: legacy ?? { ...defaultAppearanceFonts },
      themeSettings: {},
    };
  }
}

export async function readAppearanceChoice(): Promise<AppearanceChoice> {
  return (await readAppearance()).choice;
}

async function writeSettings(settings: AppearanceSettings): Promise<AppearanceSettings> {
  await writeFileAtomic(appearancePath(), JSON.stringify(settings, null, 2) + "\n");
  // The short-lived typography.json is absorbed into appearance.json.
  await rm(legacyTypographyPath(), { force: true });
  return settings;
}

/**
 * Partial update of appearance settings, with nested values merged per key.
 */
export function writeAppearance(
  patch: { choice?: unknown; fonts?: unknown; themeSettings?: unknown },
  externalThemes?: readonly Pick<AvailableTheme, "id" | "settings">[],
): Promise<AppearanceSettings> {
  return withFileLock(appearancePath(), async () => {
    const current = await readAppearance();
    let choice = current.choice;
    if (patch.choice !== undefined) {
      if (!isAppearanceChoice(patch.choice)) throw new Error("Неизвестная цветовая схема");
      if (
        !isBuiltinAppearance(patch.choice) &&
        externalThemes &&
        !externalThemes.some((theme) => theme.id === patch.choice)
      )
        throw new Error("Внешняя цветовая схема недоступна");
      choice = patch.choice;
    }
    const fonts =
      patch.fonts !== undefined ? mergeAppearanceFonts(current.fonts, patch.fonts) : current.fonts;
    const themeSettings = { ...current.themeSettings };
    if (patch.themeSettings !== undefined) {
      if (
        !patch.themeSettings ||
        typeof patch.themeSettings !== "object" ||
        Array.isArray(patch.themeSettings)
      )
        throw new Error("Укажите настройки по ID темы");
      for (const [id, values] of Object.entries(patch.themeSettings)) {
        const fields = (builtinAppearance(id) ?? externalThemes?.find((theme) => theme.id === id))
          ?.settings;
        if (!fields?.length) throw new Error("Настройки для этой темы недоступны");
        themeSettings[id] = mergeThemeValues(fields, themeSettings[id], values);
      }
    }
    return writeSettings({ choice, fonts, themeSettings });
  });
}

/** Colour-scheme-only write used by older callers; fonts on disk are preserved. */
export async function writeAppearanceChoice(
  value: unknown,
  availableThemeIds?: readonly string[],
): Promise<{ choice: AppearanceChoice }> {
  const settings = await writeAppearance(
    { choice: value },
    availableThemeIds?.map((id) => ({ id })),
  );
  return { choice: settings.choice };
}
