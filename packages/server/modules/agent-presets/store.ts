import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  isAgentPresetId,
  normalizeAgentPreset,
  type AgentPreset,
  type AgentPresetSettings,
} from "@ai-projector/core/modules/agent-preset/index.ts";
import { writeFileAtomic, withFileLock } from "../atomic-files/index.ts";

/** Where the user's own presets live: `$XDG_DATA_HOME/projector/agent/presets.json`. */
export const presetsFile = () => join(dataDir(), "agent", "presets.json");

interface Stored {
  version: 1;
  presets: AgentPreset[];
}

const empty = (): Stored => ({ version: 1, presets: [] });

function stateOf(text: string): Stored {
  const data = JSON.parse(text) as { presets?: unknown };
  const presets: AgentPreset[] = [];
  if (!Array.isArray(data?.presets)) return empty();
  for (const item of data.presets) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = (item as { id?: unknown }).id;
    if (!isAgentPresetId(id)) continue;
    const preset = normalizeAgentPreset(item);
    if (!preset || presets.some((known) => known.id === id)) continue;
    presets.push({ id, ...preset });
  }
  return { version: 1, presets };
}

async function readState(): Promise<Stored> {
  try {
    return stateOf(await readFile(presetsFile(), "utf8"));
  } catch {
    return empty();
  }
}

/** Пишется целиком и с закрытыми для остальных правами: очередь держит `withFileLock`. */
async function writeState(state: Stored): Promise<void> {
  await writeFileAtomic(presetsFile(), `${JSON.stringify(state, null, 2)}\n`);
}

function newPresetId(existing: readonly AgentPreset[]): string {
  for (;;) {
    const id = `preset-${randomBytes(4).toString("hex")}`;
    if (!existing.some((preset) => preset.id === id)) return id;
  }
}

export async function presetSettings(): Promise<AgentPresetSettings> {
  return { presets: (await readState()).presets, file: presetsFile() };
}

export async function createPreset(value: unknown): Promise<AgentPresetSettings> {
  const preset = normalizeAgentPreset(value);
  if (!preset) throw new Error("Некорректный пресет: укажите название и текст или форму");
  return withFileLock(presetsFile(), async () => {
    const state = await readState();
    state.presets = [...state.presets, { id: newPresetId(state.presets), ...preset }];
    await writeState(state);
    return presetSettings();
  });
}

export async function savePreset(id: string, value: unknown): Promise<AgentPresetSettings> {
  if (!isAgentPresetId(id)) throw new Error(`Неизвестный пресет: ${String(id)}`);
  const preset = normalizeAgentPreset(value);
  if (!preset) throw new Error("Некорректный пресет: укажите название и текст или форму");
  return withFileLock(presetsFile(), async () => {
    const state = await readState();
    if (!state.presets.some((item) => item.id === id))
      throw new Error(`Неизвестный пресет: ${String(id)}`);
    state.presets = state.presets.map((item) => (item.id === id ? { id, ...preset } : item));
    await writeState(state);
    return presetSettings();
  });
}

export async function deletePreset(id: string): Promise<AgentPresetSettings> {
  if (!isAgentPresetId(id)) throw new Error(`Неизвестный пресет: ${String(id)}`);
  return withFileLock(presetsFile(), async () => {
    const state = await readState();
    if (!state.presets.some((item) => item.id === id))
      throw new Error(`Неизвестный пресет: ${String(id)}`);
    state.presets = state.presets.filter((item) => item.id !== id);
    await writeState(state);
    return presetSettings();
  });
}
