import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "../../../core/modules/app-paths/index.ts";
import { parseKeybindings } from "../../../core/modules/ide/index.ts";
const settingsPath = () => join(dataDir(), "keybindings.json");
let pending: Promise<unknown> = Promise.resolve();
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
  const task = pending.then(async () => {
    await mkdir(dataDir(), { recursive: true });
    const path = settingsPath();
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(bindings, null, 2) + "\n", { mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return { path, bindings };
  });
  pending = task.catch(() => undefined);
  return task;
}
