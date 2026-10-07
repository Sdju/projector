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
  /** Ids (`app:…`, `project:…`) pinned to the top of the palette. */
  favorites: string[];
  /** Terminal programs that have a graphical chat, mapped to how new sessions open. */
  agentModes: Record<string, AgentSessionMode>;
  /** Last model/effort/mode choice per agent backend, by control id; new chats start from it. */
  agentDefaults: Record<string, Record<string, string>>;
}

export type AgentSessionMode = "tui" | "gui";
/** Programs whose sessions can be shown as a chat; everything else is always a terminal. */
export const GUI_AGENT_PROGRAMS: readonly string[] = ["claude", "codex", "opencode", "cursor"];

const preferencesPath = () => join(dataDir(), "launcher.json");
let saving: Promise<unknown> = Promise.resolve();
export async function preferences(): Promise<Preferences> {
  try {
    const data = JSON.parse(await readFile(preferencesPath(), "utf8"));
    return {
      mode: interfaceMode(data.mode),
      shortcut: shortcuts.includes(data.shortcut) ? data.shortcut : "Ctrl+Alt+Space",
      usage: data.usage ?? {},
      favorites: Array.isArray(data.favorites)
        ? data.favorites.filter((id: unknown): id is string => typeof id === "string")
        : [],
      agentModes: agentModes(data.agentModes),
      agentDefaults: agentDefaults(data.agentDefaults),
    };
  } catch {
    return {
      mode: "native",
      shortcut: "Ctrl+Alt+Space",
      usage: {},
      favorites: [],
      agentModes: {},
      agentDefaults: {},
    };
  }
}
function agentDefaults(value: unknown): Record<string, Record<string, string>> {
  const defaults: Record<string, Record<string, string>> = {};
  if (!value || typeof value !== "object") return defaults;
  for (const [backend, choice] of Object.entries(value as Record<string, unknown>)) {
    if (!choice || typeof choice !== "object") continue;
    const picked: Record<string, string> = {};
    for (const [id, item] of Object.entries(choice as Record<string, unknown>))
      if (typeof item === "string") picked[id] = item;
    if (Object.keys(picked).length) defaults[backend] = picked;
  }
  return defaults;
}
function agentModes(value: unknown): Record<string, AgentSessionMode> {
  const modes: Record<string, AgentSessionMode> = {};
  if (value && typeof value === "object")
    for (const program of GUI_AGENT_PROGRAMS)
      if ((value as Record<string, unknown>)[program] === "gui") modes[program] = "gui";
  return modes;
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
/** Adds or removes a favorite and returns the new state. */
export async function toggleFavorite(id: string): Promise<boolean> {
  let favorite = false;
  await updatePreferences((value) => {
    favorite = !value.favorites.includes(id);
    value.favorites = favorite
      ? [...value.favorites, id]
      : value.favorites.filter((entry) => entry !== id);
  });
  return favorite;
}
/** Sets how new sessions of `program` open; TUI is the default and is stored as absence. */
export async function setAgentMode(program: string, mode: AgentSessionMode): Promise<void> {
  if (!GUI_AGENT_PROGRAMS.includes(program))
    throw new Error("У этого агента нет графического режима");
  await updatePreferences((value) => {
    if (mode === "gui") value.agentModes[program] = "gui";
    else delete value.agentModes[program];
  });
}
/** Remembers one control choice of an agent backend as the default for new chats. */
export async function setAgentDefault(backend: string, id: string, value: string): Promise<void> {
  if (!backend || !id || backend.length > 40 || id.length > 100 || value.length > 300)
    throw new Error("Некорректный выбор");
  await updatePreferences((preferences) => {
    preferences.agentDefaults[backend] = { ...preferences.agentDefaults[backend], [id]: value };
  });
}
