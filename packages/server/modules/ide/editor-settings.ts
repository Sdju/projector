import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  defaultEditorTheme,
  isEditorTheme,
} from "@ai-projector/core/modules/editor-themes/index.ts";
import { writeFileAtomic, withFileLock } from "../atomic-files/index.ts";
const settingsPath = () => join(dataDir(), "editor.json");
export async function readEditorSettings() {
  try {
    const data = JSON.parse(await readFile(settingsPath(), "utf8"));
    return { theme: isEditorTheme(data?.theme) ? data.theme : defaultEditorTheme };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { theme: defaultEditorTheme };
    throw error;
  }
}
export async function writeEditorSettings(theme: unknown) {
  if (!isEditorTheme(theme)) throw new Error("Неизвестная тема редактора");
  return withFileLock(settingsPath(), async () => {
    await writeFileAtomic(settingsPath(), JSON.stringify({ theme }, null, 2) + "\n");
    return { theme };
  });
}
