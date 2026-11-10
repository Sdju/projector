import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  appearanceFile,
  defaultAppearance,
  isAppearanceChoice,
  type AppearanceChoice,
} from "@ai-projector/core/modules/appearance/index.ts";

const appearancePath = () => join(dataDir(), appearanceFile);
let pending: Promise<unknown> = Promise.resolve();

export async function readAppearanceChoice(): Promise<AppearanceChoice> {
  try {
    const data = JSON.parse(await readFile(appearancePath(), "utf8"));
    return isAppearanceChoice(data?.choice) ? data.choice : defaultAppearance;
  } catch {
    // Appearance is cosmetic: a missing, damaged or unreadable file must not block the app.
    return defaultAppearance;
  }
}

export async function writeAppearanceChoice(value: unknown): Promise<{ choice: AppearanceChoice }> {
  if (!isAppearanceChoice(value)) throw new Error("Неизвестная цветовая схема");
  const task = pending.then(async () => {
    await mkdir(dataDir(), { recursive: true });
    const file = appearancePath();
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ choice: value }, null, 2) + "\n", {
        mode: 0o600,
      });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
    return { choice: value };
  });
  pending = task.catch(() => undefined);
  return task;
}
