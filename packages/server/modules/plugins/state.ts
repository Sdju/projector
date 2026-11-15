import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { writeFileAtomic, setAsideBroken, withFileLock } from "../atomic-files/index.ts";

export interface StoredPluginState {
  enabled: boolean;
  version?: string;
  /** Content hash the user confirmed for an agent plugin; themes do not need one. */
  trustedHash?: string;
}

export type PluginState = Record<string, StoredPluginState>;

export function statePath(): string {
  return join(dataDir(), "plugins.json");
}

async function readJson(path: string): Promise<unknown> {
  const content = await readFile(path, "utf8");
  if (content.length > 1_000_000) throw new Error("Файл состояния плагинов слишком большой");
  return JSON.parse(content);
}

export async function readState(): Promise<PluginState> {
  try {
    const value = await readJson(statePath());
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const source =
      "plugins" in value && value.plugins && typeof value.plugins === "object"
        ? value.plugins
        : value;
    const state: PluginState = {};
    for (const [id, entry] of Object.entries(source)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.enabled === "boolean")
        state[id] = {
          enabled: item.enabled,
          version: typeof item.version === "string" ? item.version : undefined,
          trustedHash: typeof item.trustedHash === "string" ? item.trustedHash : undefined,
        };
    }
    return state;
  } catch (error) {
    // A damaged file must not be silently replaced by the next write: preserve it for inspection.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await setAsideBroken(statePath()).catch(() => undefined);
      console.warn("Плагины: файл состояния повреждён и отложен");
    }
    return {};
  }
}

async function writeState(state: PluginState): Promise<void> {
  await writeFileAtomic(statePath(), `${JSON.stringify({ plugins: state }, null, 2)}\n`);
}

/** Writes are serialized per file: discovery and an enable action may run at the same time. */
export async function updateState(id: string, value: StoredPluginState): Promise<void> {
  await withFileLock(statePath(), async () => {
    const state = await readState();
    state[id] = value;
    await writeState(state);
  });
}

export async function deleteState(id: string): Promise<void> {
  await withFileLock(statePath(), async () => {
    const state = await readState();
    delete state[id];
    await writeState(state);
  });
}
