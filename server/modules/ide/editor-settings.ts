import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "../../../core/modules/app-paths/index.ts";
import { defaultEditorTheme, isEditorTheme } from "../../../core/modules/editor-themes/index.ts";
const settingsPath = () => join(dataDir(), "editor.json");
let pending: Promise<unknown> = Promise.resolve();
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
  const task = pending.then(async () => {
    await mkdir(dataDir(), { recursive: true });
    const path = settingsPath();
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ theme }, null, 2) + "\n", { mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return { theme };
  });
  pending = task.catch(() => undefined);
  return task;
}
