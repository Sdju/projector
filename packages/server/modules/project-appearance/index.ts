import { randomBytes } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  normalizeProjectAppearanceOverride,
  type ProjectAppearanceOverride,
  type ProjectAppearanceState,
} from "@ai-projector/core/modules/appearance/index.ts";
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

/** Appearance a project keeps in its repository; inert until the user trusts this exact file. */
export const projectAppearanceRelativeFile = ".projector/appearance.json";
export const projectAppearanceTrustFile = () => join(dataDir(), "appearance-trust.json");

interface AppearanceTrustEntry extends TrustRecord {
  at: string;
}

const appearanceTrust = createTrustStore<AppearanceTrustEntry>({
  file: projectAppearanceTrustFile,
  fields: ["hash", "at"],
});

const appearanceFile = (
  projectId: string,
): TrustedProjectFileSpec<ProjectAppearanceOverride, AppearanceTrustEntry> => ({
  projectId,
  relativeFile: projectAppearanceRelativeFile,
  trust: appearanceTrust,
  parse: overrideOf,
  fallback: {},
  escape: "Файл оформления проекта указывает за его пределы",
  unreadable: "Не удалось прочитать оформление проекта",
});

/** Состояние оформления проекта: файл, его хеш и решение пользователя. */
function appearanceState(projectId: string, file: TrustedProjectFile<ProjectAppearanceOverride>) {
  const state: ProjectAppearanceState = {
    projectId,
    path: file.root,
    file: file.file,
    exists: file.exists,
    trusted: file.trusted,
    override: file.value,
  };
  if (file.hash) state.hash = file.hash;
  if (file.problem) state.problem = file.problem;
  return state;
}

function overrideOf(text: string): ProjectAppearanceOverride {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Файл оформления проекта повреждён");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Файл оформления проекта повреждён");
  return normalizeProjectAppearanceOverride(value);
}

/** The project's appearance file and its trust decision; untrusted overrides are never applied. */
export async function projectAppearanceState(projectId: string): Promise<ProjectAppearanceState> {
  return appearanceState(projectId, await readTrustedProjectFile(appearanceFile(projectId)));
}

/** Вид доверия к оформлению проекта для реестра `project-trust`. */
export const projectAppearanceTrustDescriptor: ProjectTrustDescriptor = projectTrustDescriptor(
  "appearance",
  appearanceTrust,
  async (projectId) => trustStateOf(await readTrustedProjectFile(appearanceFile(projectId))),
);

/** Only a trusted override reaches the live theme; missing or untrusted means inherit global. */
export async function trustedProjectAppearance(
  projectId: string | undefined,
): Promise<ProjectAppearanceOverride | undefined> {
  if (!projectId) return undefined;
  try {
    const state = await projectAppearanceState(projectId);
    return state.trusted ? state.override : undefined;
  } catch {
    return undefined;
  }
}

/** Trusts (or stops trusting) the current contents of the project's appearance file. */
export async function setProjectAppearanceTrust(
  projectId: string,
  trusted: boolean,
): Promise<ProjectAppearanceState> {
  const state = await projectAppearanceState(projectId);
  if (trusted && !state.exists) throw new Error("В проекте нет файла оформления");
  if (trusted && (!state.hash || state.problem))
    throw new Error("Файлу оформления проекта нельзя доверять");
  await appearanceTrust.set(
    state.path,
    trusted ? { hash: state.hash!, at: new Date().toISOString() } : null,
  );
  return projectAppearanceState(projectId);
}

async function writeOverride(root: string, override: ProjectAppearanceOverride): Promise<void> {
  const file = await projectWriteTarget(
    root,
    projectAppearanceRelativeFile,
    "Папка .projector указывает за пределы проекта",
  );
  const body: Record<string, unknown> = { version: 1 };
  if (override.choice !== undefined) body.choice = override.choice;
  if (override.fonts && Object.keys(override.fonts).length) body.fonts = override.fonts;
  const temporary = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
  await rename(temporary, file);
}

/**
 * Writes the project override. Any write changes the hash and drops trust until the user
 * approves the new contents.
 */
export async function writeProjectAppearance(
  projectId: string,
  value: unknown,
): Promise<ProjectAppearanceState> {
  const override = normalizeProjectAppearanceOverride(value);
  const file = await writeTrustedProjectFile({
    ...appearanceFile(projectId),
    change: () => override,
    write: writeOverride,
    // Оформление живёт по совпадению хеша: правка обычно требует нового подтверждения.
    afterWrite: "rehash",
    record: (hash) => ({ hash, at: new Date().toISOString() }),
  });
  return appearanceState(projectId, file);
}
