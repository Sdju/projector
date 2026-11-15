import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { parseKeybindings } from "@ai-projector/core/modules/ide/index.ts";
import { writeFileAtomic, withFileLock } from "../atomic-files/index.ts";
const settingsPath = () => join(dataDir(), "keybindings.json");
export async function readKeybindings() {
  let contents: string;
  try {
    contents = await readFile(settingsPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { path: settingsPath(), bindings: [] };
    throw error;
  }
  return { path: settingsPath(), bindings: parseKeybindings(JSON.parse(contents)) };
}
export async function writeKeybindings(value: unknown) {
  const bindings = parseKeybindings(value);
  return withFileLock(settingsPath(), async () => {
    const path = settingsPath();
    await writeFileAtomic(path, JSON.stringify(bindings, null, 2) + "\n");
    return { path, bindings };
  });
}
