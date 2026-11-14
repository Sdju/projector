import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { os } from "@ai-projector/core/modules/os/index.ts";
import {
  normalizeProjectAppearanceOverride,
  type ProjectAppearanceOverride,
  type ProjectAppearanceState,
} from "@ai-projector/core/modules/appearance/index.ts";
import { loadProjects } from "../projects/index.ts";

/** Appearance a project keeps in its repository; inert until the user trusts this exact file. */
export const projectAppearanceRelativeFile = ".projector/appearance.json";
export const projectAppearanceTrustFile = () => join(dataDir(), "appearance-trust.json");

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
    return readTrustFile(await readFile(projectAppearanceTrustFile(), "utf8"));
  } catch {
    return { version: 1, projects: {} };
  }
}

let queue: Promise<unknown> = Promise.resolve();

async function writeTrust(file: TrustFile): Promise<void> {
  const path = projectAppearanceTrustFile();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
  await os.tools.restrictToOwner(path);
}

/** Rejects a `.projector` folder or appearance file that escapes the project through a symlink. */
async function safeProjectFile(root: string, file: string): Promise<string> {
  const real = await realpath(file);
  const rel = relative(root, real);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Файл оформления проекта указывает за его пределы");
  return real;
}

function overrideOf(text: string): ProjectAppearanceOverride {
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Файл оформления проекта повреждён");
  return normalizeProjectAppearanceOverride(value);
}

function appearanceFile(root: string): string {
  return join(root, projectAppearanceRelativeFile);
}

/** The project's appearance file and its trust decision; untrusted overrides are never applied. */
export async function projectAppearanceState(projectId: string): Promise<ProjectAppearanceState> {
  const root = await projectRoot(projectId);
  const file = appearanceFile(root);
  const trust = await readTrust();
  try {
    const raw = await readFile(file, "utf8");
    const real = await safeProjectFile(root, file);
    const hash = hashOf(raw);
    let override: ProjectAppearanceOverride;
    try {
      override = overrideOf(raw);
    } catch (error) {
      return {
        projectId,
        path: root,
        file: real,
        exists: true,
        trusted: false,
        hash,
        override: {},
        problem:
          error instanceof Error && error.message.startsWith("Файл")
            ? error.message
            : "Файл оформления проекта повреждён",
      };
    }
    return {
      projectId,
      path: root,
      file: real,
      exists: true,
      trusted: trust.projects[root]?.hash === hash,
      hash,
      override,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        projectId,
        path: root,
        file,
        exists: false,
        trusted: false,
        override: {},
      };
    return {
      projectId,
      path: root,
      file,
      exists: false,
      trusted: false,
      override: {},
      problem: error instanceof Error ? error.message : "Не удалось прочитать оформление проекта",
    };
  }
}

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
  const task = queue.then(async () => {
    const file = await readTrust();
    if (trusted) file.projects[state.path] = { hash: state.hash!, at: new Date().toISOString() };
    else delete file.projects[state.path];
    await writeTrust(file);
    return projectAppearanceState(projectId);
  });
  queue = task.catch(() => undefined);
  return task;
}

async function writeOverride(root: string, override: ProjectAppearanceOverride): Promise<void> {
  const file = appearanceFile(root);
  const directory = dirname(file);
  await mkdir(directory, { recursive: true });
  const realDirectory = await realpath(directory);
  const rel = relative(root, realDirectory);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Папка .projector указывает за пределы проекта");
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
  const task = queue.then(async () => {
    const state = await projectAppearanceState(projectId);
    if (state.problem && state.exists) throw new Error(state.problem);
    await writeOverride(state.path, override);
    return projectAppearanceState(projectId);
  });
  queue = task.catch(() => undefined);
  return task;
}
