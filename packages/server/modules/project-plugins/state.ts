import { readFile } from "node:fs/promises";
import { setAsideBroken, withFileLock, writeFileAtomic } from "../atomic-files/index.ts";
import { projectPluginStateFile } from "./directory.ts";

export interface StoredProjectPlugin {
  enabled?: boolean;
  /** Content hash the user confirmed for a package with executable or agent code. */
  trustedHash?: string;
}

/** Real project root → manifest package name → state. A renamed project keeps its decision. */
export type ProjectPluginState = Record<string, Record<string, StoredProjectPlugin>>;

const maxStateBytes = 1_000_000;

function validEntry(value: unknown): StoredProjectPlugin | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;
  return {
    ...(typeof entry.enabled === "boolean" ? { enabled: entry.enabled } : {}),
    ...(typeof entry.trustedHash === "string" && entry.trustedHash
      ? { trustedHash: entry.trustedHash }
      : {}),
  };
}

export async function readProjectPluginState(): Promise<ProjectPluginState> {
  let raw: string;
  try {
    raw = await readFile(projectPluginStateFile(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.warn("Плагины проекта: не удалось прочитать состояние");
    return {};
  }
  if (raw.length > maxStateBytes) {
    console.warn("Плагины проекта: файл состояния слишком большой");
    return {};
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    await setAsideBroken(projectPluginStateFile()).catch(() => undefined);
    console.warn("Плагины проекта: файл состояния повреждён и отложен");
    return {};
  }
  const projects = (value as { projects?: unknown })?.projects;
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) return {};
  const state: ProjectPluginState = {};
  for (const [root, packages] of Object.entries(projects)) {
    if (!root || !packages || typeof packages !== "object" || Array.isArray(packages)) continue;
    const entries: Record<string, StoredProjectPlugin> = {};
    for (const [name, entry] of Object.entries(packages)) {
      const valid = validEntry(entry);
      if (valid) entries[name] = valid;
    }
    state[root] = entries;
  }
  return state;
}

async function writeState(state: ProjectPluginState): Promise<void> {
  await writeFileAtomic(
    projectPluginStateFile(),
    `${JSON.stringify({ projects: state }, null, 2)}\n`,
  );
}

/** Serialized per file: discovery, a trust action and a settings toggle may overlap. */
export async function updateProjectPluginState(
  root: string,
  name: string,
  change: (current: StoredProjectPlugin) => StoredProjectPlugin,
): Promise<StoredProjectPlugin> {
  let next: StoredProjectPlugin = {};
  await withFileLock(projectPluginStateFile(), async () => {
    const state = await readProjectPluginState();
    const packages = state[root] ?? {};
    next = change(packages[name] ?? {});
    packages[name] = next;
    state[root] = packages;
    await writeState(state);
  });
  return next;
}

export async function projectPluginStateOf(
  root: string,
  name: string,
): Promise<StoredProjectPlugin | undefined> {
  return (await readProjectPluginState())[root]?.[name];
}
