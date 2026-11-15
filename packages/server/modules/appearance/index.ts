import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  appearanceFile,
  defaultAppearance,
  defaultAppearanceFonts,
  isAppearanceChoice,
  legacyTypographyFile,
  mergeAppearanceFonts,
  normalizeAppearance,
  normalizeAppearanceFonts,
  type AppearanceChoice,
  type AppearanceFonts,
  type AppearanceSettings,
} from "@ai-projector/core/modules/appearance/index.ts";
import { writeFileAtomic, withFileLock } from "../atomic-files/index.ts";

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
 * Partial update: `choice` and/or `fonts`. Omitting a field keeps the saved value.
 * `fonts` itself is merged per key so a single slider can save without rewriting the rest.
 */
export function writeAppearance(
  patch: { choice?: unknown; fonts?: unknown },
  availableThemeIds?: readonly string[],
): Promise<AppearanceSettings> {
  return withFileLock(appearancePath(), async () => {
    const current = await readAppearance();
    let choice = current.choice;
    if (patch.choice !== undefined) {
      if (!isAppearanceChoice(patch.choice)) throw new Error("Неизвестная цветовая схема");
      if (
        !["dark", "light", "contrast", "auto"].includes(patch.choice) &&
        availableThemeIds &&
        !availableThemeIds.includes(patch.choice)
      )
        throw new Error("Внешняя цветовая схема недоступна");
      choice = patch.choice;
    }
    const fonts =
      patch.fonts !== undefined ? mergeAppearanceFonts(current.fonts, patch.fonts) : current.fonts;
    return writeSettings({ choice, fonts });
  });
}

/** Colour-scheme-only write used by older callers; fonts on disk are preserved. */
export async function writeAppearanceChoice(
  value: unknown,
  availableThemeIds?: readonly string[],
): Promise<{ choice: AppearanceChoice }> {
  const settings = await writeAppearance({ choice: value }, availableThemeIds);
  return { choice: settings.choice };
}
