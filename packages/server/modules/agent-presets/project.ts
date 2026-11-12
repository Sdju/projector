import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { os } from "@ai-projector/core/modules/os/index.ts";
import {
  isAgentPresetId,
  normalizeAgentPreset,
  projectPresetsRelativeFile,
  type AgentPreset,
  type AgentProjectPresetState,
} from "@ai-projector/core/modules/agent-preset/index.ts";
import { loadProjects } from "../projects/index.ts";

/** Presets a project keeps in its repository; inert until the user trusts this exact file. */
export const projectPresetsTrustFile = () => join(dataDir(), "agent", "preset-trust.json");

interface TrustFile {
  version: 1;
  projects: Record<string, { hash: string; at: string }>;
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");

async function projectRoot(projectId: string): Promise<string> {
  const project = (await loadProjects()).find((item) => item.id === projectId);
  if (!project) throw new Error("Проект не найден");
  return realpath(project.path);
}

function readTrustFile(text: string): TrustFile {
  try {
    const value = JSON.parse(text) as { projects?: unknown };
    const projects: TrustFile["projects"] = {};
    if (value?.projects && typeof value.projects === "object" && !Array.isArray(value.projects))
      for (const [path, item] of Object.entries(value.projects as Record<string, unknown>)) {
        const row = item as { hash?: unknown; at?: unknown };
        if (typeof row?.hash === "string" && typeof row.at === "string")
          projects[path] = { hash: row.hash, at: row.at };
      }
    return { version: 1, projects };
  } catch {
    return { version: 1, projects: {} };
  }
}

async function readTrust(): Promise<TrustFile> {
  try {
    return readTrustFile(await readFile(projectPresetsTrustFile(), "utf8"));
  } catch {
    return { version: 1, projects: {} };
  }
}

async function writeTrust(file: TrustFile): Promise<void> {
  const path = projectPresetsTrustFile();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
  await os.tools.restrictToOwner(path);
}

/** Rejects a `.projector` folder or presets file that escapes the project through a symlink. */
async function safeProjectFile(root: string, file: string): Promise<string> {
  const real = await realpath(file);
  const rel = relative(root, real);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Файл пресетов проекта указывает за его пределы");
  return real;
}

function presetsOf(text: string): AgentPreset[] {
  const value = JSON.parse(text) as { presets?: unknown };
  if (!Array.isArray(value?.presets)) throw new Error("В файле пресетов проекта нет presets");
  const presets: AgentPreset[] = [];
  for (const item of value.presets) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = (item as { id?: unknown }).id;
    if (!isAgentPresetId(id)) continue;
    const preset = normalizeAgentPreset(item);
    if (!preset || presets.some((known) => known.id === id)) continue;
    presets.push({ id, ...preset });
  }
  return presets;
}

/** The project's presets file and its trust decision; a broken or unsafe file is reported. */
export async function projectPresetState(projectId: string): Promise<AgentProjectPresetState> {
  const root = await projectRoot(projectId);
  const file = join(root, projectPresetsRelativeFile);
  const trust = await readTrust();
  try {
    const raw = await readFile(file, "utf8");
    const real = await safeProjectFile(root, file);
    const hash = hashOf(raw);
    let presets: AgentPreset[];
    try {
      presets = presetsOf(raw);
    } catch (error) {
      return {
        projectId,
        path: root,
        file: real,
        exists: true,
        trusted: false,
        hash,
        presets: [],
        problem:
          error instanceof Error && error.message.startsWith("В файле")
            ? error.message
            : "Файл пресетов проекта повреждён",
      };
    }
    return {
      projectId,
      path: root,
      file: real,
      exists: true,
      trusted: trust.projects[root]?.hash === hash,
      hash,
      presets,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        projectId,
        path: root,
        file,
        exists: false,
        trusted: false,
        presets: [],
      };
    return {
      projectId,
      path: root,
      file,
      exists: false,
      trusted: false,
      presets: [],
      problem: error instanceof Error ? error.message : "Не удалось прочитать пресеты проекта",
    };
  }
}

function projectPresetsFile(root: string): string {
  return join(root, projectPresetsRelativeFile);
}

function newPresetId(existing: readonly AgentPreset[]): string {
  for (;;) {
    const id = `preset-${randomBytes(4).toString("hex")}`;
    if (!existing.some((preset) => preset.id === id)) return id;
  }
}

async function writePresets(root: string, presets: AgentPreset[]): Promise<void> {
  const file = projectPresetsFile(root);
  const directory = dirname(file);
  await mkdir(directory, { recursive: true });
  // `.projector` itself may be a symlink out of the project.
  const realDirectory = await realpath(directory);
  const rel = relative(root, realDirectory);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Папка .projector указывает за пределы проекта");
  const temporary = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, presets }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
  await rename(temporary, file);
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Writes the trust decision for an already read state. The caller owns the write queue, so a
 * modification can keep the file trusted in the same step as the write.
 */
async function trustState(
  projectId: string,
  state: AgentProjectPresetState,
  trusted: boolean,
): Promise<AgentProjectPresetState> {
  const file = await readTrust();
  if (trusted) file.projects[state.path] = { hash: state.hash!, at: new Date().toISOString() };
  else delete file.projects[state.path];
  await writeTrust(file);
  return projectPresetState(projectId);
}

async function modify(
  projectId: string,
  action: (presets: AgentPreset[]) => AgentPreset[],
): Promise<AgentProjectPresetState> {
  const task = queue.then(async () => {
    const state = await projectPresetState(projectId);
    if (state.problem) throw new Error(state.problem);
    // A new file or an already trusted one comes from the user's own Projector action; a file
    // that arrived with the repository stays inert until the user reviews and trusts it.
    const keepTrust = !state.exists || state.trusted;
    await writePresets(state.path, action(state.presets));
    const next = await projectPresetState(projectId);
    if (keepTrust && next.hash && !next.problem) return trustState(projectId, next, true);
    return next;
  });
  queue = task.catch(() => undefined);
  return task;
}

/** Creates a project preset; a new safe file stays trusted for the start screen. */
export async function createProjectPreset(
  projectId: string,
  value: unknown,
): Promise<AgentProjectPresetState> {
  const preset = normalizeAgentPreset(value);
  if (!preset) throw new Error("Некорректный пресет: укажите название и текст или форму");
  return modify(projectId, (presets) => [...presets, { id: newPresetId(presets), ...preset }]);
}

export async function saveProjectPreset(
  projectId: string,
  id: string,
  value: unknown,
): Promise<AgentProjectPresetState> {
  if (!isAgentPresetId(id)) throw new Error(`Неизвестный пресет: ${String(id)}`);
  const preset = normalizeAgentPreset(value);
  if (!preset) throw new Error("Некорректный пресет: укажите название и текст или форму");
  return modify(projectId, (presets) => {
    if (!presets.some((item) => item.id === id))
      throw new Error(`Неизвестный пресет: ${String(id)}`);
    return presets.map((item) => (item.id === id ? { id, ...preset } : item));
  });
}

export async function deleteProjectPreset(
  projectId: string,
  id: string,
): Promise<AgentProjectPresetState> {
  if (!isAgentPresetId(id)) throw new Error(`Неизвестный пресет: ${String(id)}`);
  return modify(projectId, (presets) => {
    if (!presets.some((item) => item.id === id))
      throw new Error(`Неизвестный пресет: ${String(id)}`);
    return presets.filter((item) => item.id !== id);
  });
}

/** Trusts (or stops trusting) the current contents of the project's presets file. */
export async function setProjectPresetTrust(
  projectId: string,
  trusted: boolean,
): Promise<AgentProjectPresetState> {
  const state = await projectPresetState(projectId);
  if (trusted && !state.exists) throw new Error("В проекте нет файла пресетов");
  if (trusted && (!state.hash || state.problem))
    throw new Error("Файлу пресетов проекта нельзя доверять");
  const task = queue.then(() => trustState(projectId, state, trusted));
  queue = task.catch(() => undefined);
  return task;
}

/** Presets the project may offer at chat start: only a trusted file reaches the picker. */
export async function trustedProjectPresets(projectId: string): Promise<AgentPreset[]> {
  const state = await projectPresetState(projectId);
  return state.trusted ? state.presets : [];
}

export { projectPresetsRelativeFile };
