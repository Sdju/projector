import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "../../../core/modules/app-paths/index.ts";
import { shortcuts, type InterfaceMode } from "../../../core/modules/launcher/index.ts";
interface Usage {
  count: number;
  last: number;
}
interface Preferences {
  mode: InterfaceMode;
  shortcut: string;
  usage: Record<string, Usage>;
}

const preferencesPath = () => join(dataDir(), "launcher.json");
let saving: Promise<unknown> = Promise.resolve();
export async function preferences(): Promise<Preferences> {
  try {
    const data = JSON.parse(await readFile(preferencesPath(), "utf8"));
    return {
      mode: interfaceMode(data.mode),
      shortcut: shortcuts.includes(data.shortcut) ? data.shortcut : "Ctrl+Alt+Space",
      usage: data.usage ?? {},
    };
  } catch {
    return { mode: "native", shortcut: "Ctrl+Alt+Space", usage: {} };
  }
}
export function interfaceMode(value: unknown): InterfaceMode {
  return value === "window" || value === "browser" ? value : "native";
}
export function updatePreferences(update: (value: Preferences) => void): Promise<void> {
  const task = saving.then(async () => {
    const value = await preferences();
    update(value);
    await mkdir(dataDir(), { recursive: true });
    const file = preferencesPath();
    await writeFile(`${file}.tmp`, JSON.stringify(value, null, 2) + "\n");
    await rename(`${file}.tmp`, file);
  });
  saving = task.catch(() => undefined);
  return task;
}
export function saveInterface(mode: InterfaceMode, shortcut?: string): Promise<void> {
  return updatePreferences((value) => {
    value.mode = mode;
    if (shortcut !== undefined) value.shortcut = shortcut;
  });
}
