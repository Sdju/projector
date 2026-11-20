import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  isAgentPresetId,
  normalizeAgentPreset,
  projectPresetsRelativeFile,
  type AgentPreset,
  type AgentProjectPresetState,
} from "@ai-projector/core/modules/agent-preset/index.ts";
import {
  createTrustStore,
  projectTrustDescriptor,
  projectWriteTarget,
  readTrustedProjectFile,
  trustStateOf,
  writeTrustedProjectFile,
  type ProjectTrustDescriptor,
  type TrustedProjectFile,
  type TrustedProjectFileSpec,
  type TrustRecord,
} from "../trusted-project-file/index.ts";
import { writeFileAtomic } from "../atomic-files/index.ts";

/** Presets a project keeps in its repository; inert until the user trusts this exact file. */
export const projectPresetsTrustFile = () => join(dataDir(), "agent", "preset-trust.json");

interface PresetTrustEntry extends TrustRecord {
  at: string;
}

const presetsTrust = createTrustStore<PresetTrustEntry>({
  file: projectPresetsTrustFile,
  fields: ["hash", "at"],
});

const presetsFile = (
  projectId: string,
): TrustedProjectFileSpec<AgentPreset[], PresetTrustEntry> => ({
  projectId,
  relativeFile: projectPresetsRelativeFile,
  trust: presetsTrust,
  parse: presetsOf,
  fallback: [],
  escape: "Файл пресетов проекта указывает за его пределы",
  unreadable: "Не удалось прочитать пресеты проекта",
});

/** Состояние пресетов проекта: файл, его хеш и решение пользователя. */
function presetState(projectId: string, file: TrustedProjectFile<AgentPreset[]>) {
  const state: AgentProjectPresetState = {
    projectId,
    path: file.root,
    file: file.file,
    exists: file.exists,
    trusted: file.trusted,
    presets: file.value,
  };
  if (file.hash) state.hash = file.hash;
  if (file.problem) state.problem = file.problem;
  return state;
}

function presetsOf(text: string): AgentPreset[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Файл пресетов проекта повреждён");
  }
  const presets = (value as { presets?: unknown })?.presets;
  if (!Array.isArray(presets)) throw new Error("В файле пресетов проекта нет presets");
  const result: AgentPreset[] = [];
  for (const item of presets) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = (item as { id?: unknown }).id;
    if (!isAgentPresetId(id)) continue;
    const preset = normalizeAgentPreset(item);
    if (!preset || result.some((known) => known.id === id)) continue;
    result.push({ id, ...preset });
  }
  return result;
}

/** The project's presets file and its trust decision; a broken or unsafe file is reported. */
export async function projectPresetState(projectId: string): Promise<AgentProjectPresetState> {
  return presetState(projectId, await readTrustedProjectFile(presetsFile(projectId)));
}

/** Вид доверия к пресетам проекта для реестра `project-trust`. */
export const projectPresetTrustDescriptor: ProjectTrustDescriptor = projectTrustDescriptor(
  "presets",
  presetsTrust,
  async (projectId) => trustStateOf(await readTrustedProjectFile(presetsFile(projectId))),
);

function newPresetId(existing: readonly AgentPreset[]): string {
  for (;;) {
    const id = `preset-${randomBytes(4).toString("hex")}`;
    if (!existing.some((preset) => preset.id === id)) return id;
  }
}

async function writePresets(root: string, presets: AgentPreset[]): Promise<void> {
  const file = await projectWriteTarget(
    root,
    projectPresetsRelativeFile,
    "Папка .projector указывает за пределы проекта",
  );
  await writeFileAtomic(file, `${JSON.stringify({ version: 1, presets }, null, 2)}\n`, {
    mode: 0o644,
  });
}

async function modify(
  projectId: string,
  action: (presets: AgentPreset[]) => AgentPreset[],
): Promise<AgentProjectPresetState> {
  const file = await writeTrustedProjectFile({
    ...presetsFile(projectId),
    change: action,
    write: writePresets,
    // Пресет, созданный в Projector, остаётся доверенным: его написал сам пользователь. Файл,
    // пришедший с репозиторием, ждёт проверки и доверие при правке не получает.
    afterWrite: "keep",
    record: (hash) => ({ hash, at: new Date().toISOString() }),
  });
  return presetState(projectId, file);
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
  await presetsTrust.set(
    state.path,
    trusted ? { hash: state.hash!, at: new Date().toISOString() } : null,
  );
  return projectPresetState(projectId);
}

/** Presets the project may offer at chat start: only a trusted file reaches the picker. */
export async function trustedProjectPresets(projectId: string): Promise<AgentPreset[]> {
  const state = await projectPresetState(projectId);
  return state.trusted ? state.presets : [];
}

export { projectPresetsRelativeFile };
