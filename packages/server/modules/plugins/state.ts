import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";

export interface StoredPluginState {
  enabled: boolean;
  version?: string;
  /** Content hash the user confirmed for an agent plugin; themes do not need one. */
  trustedHash?: string;
}

export type PluginState = Record<string, StoredPluginState>;

/** Writes are serialized: discovery and an enable action may run at the same time. */
let pending: Promise<unknown> = Promise.resolve();

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
  } catch {
    return {};
  }
}

async function writeState(state: PluginState): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  const file = statePath();
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ plugins: state }, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function updateState(id: string, value: StoredPluginState): Promise<void> {
  const task = pending.then(async () => {
    const state = await readState();
    state[id] = value;
    await writeState(state);
  });
  pending = task.catch(() => undefined);
  return task;
}

export async function deleteState(id: string): Promise<void> {
  const task = pending.then(async () => {
    const state = await readState();
    delete state[id];
    await writeState(state);
  });
  pending = task.catch(() => undefined);
  return task;
}
