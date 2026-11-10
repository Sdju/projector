import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { os } from "@ai-projector/core/modules/os/index.ts";
import {
  normalizeProjectWidget,
  PROJECT_WIDGET_LIMITS,
  type ProjectWidgetData,
  type ProjectWidgetDefinition,
  type ProjectWidgetState,
} from "@ai-projector/core/modules/widget-catalog/index.ts";
import { loadProjects } from "../projects/index.ts";

/** Widgets a project keeps in its repository; inert until the user trusts this exact file. */
export const projectWidgetsRelativeFile = ".projector/widgets.json";
export const projectWidgetsTrustFile = () => join(dataDir(), "agent", "widget-trust.json");

/** A data file is read only on behalf of a trusted widget and never from a secret-looking path. */
const DATA_LIMIT = 1_000_000;
const SECRET_NAMES = new Set([".ssh", ".aws", ".npmrc", ".netrc", ".git-credentials", ".git"]);
const SECRET_PATTERNS = [/(^\.|\.)env($|\.)/i, /\.(pem|key)$/i, /^id_(rsa|ed25519)/i, /\.kdbx$/i];

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
    return readTrustFile(await readFile(projectWidgetsTrustFile(), "utf8"));
  } catch {
    return { version: 1, projects: {} };
  }
}

let queue: Promise<unknown> = Promise.resolve();

async function writeTrust(file: TrustFile): Promise<void> {
  const path = projectWidgetsTrustFile();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
  await os.tools.restrictToOwner(path);
}

/** Rejects a `.projector` folder or widgets file that escapes the project through a symlink. */
async function safeProjectFile(root: string, file: string): Promise<string> {
  const real = await realpath(file);
  const rel = relative(root, real);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Файл виджетов проекта указывает за его пределы");
  return real;
}

function widgetsOf(text: string): ProjectWidgetDefinition[] {
  const value = JSON.parse(text) as { widgets?: unknown };
  if (!Array.isArray(value?.widgets)) throw new Error("В файле виджетов проекта нет widgets");
  const rows = value.widgets
    .slice(0, PROJECT_WIDGET_LIMITS.widgets)
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  const names = rows.flatMap((row) =>
    typeof row.name === "string" && row.name.trim() ? [row.name.trim()] : [],
  );
  const widgets: ProjectWidgetDefinition[] = [];
  for (const row of rows) {
    const widget = normalizeProjectWidget(row, names);
    if (!widget || widgets.some((known) => known.name === widget.name)) continue;
    widgets.push(widget);
  }
  return widgets;
}

/** The project's widgets file and its trust decision; a broken or unsafe file is reported, not used. */
export async function projectWidgetState(projectId: string): Promise<ProjectWidgetState> {
  const root = await projectRoot(projectId);
  const file = join(root, projectWidgetsRelativeFile);
  const trust = await readTrust();
  try {
    const raw = await readFile(file, "utf8");
    const real = await safeProjectFile(root, file);
    const hash = hashOf(raw);
    let widgets: ProjectWidgetDefinition[];
    try {
      widgets = widgetsOf(raw);
    } catch (error) {
      return {
        projectId,
        path: root,
        file: real,
        exists: true,
        trusted: false,
        hash,
        widgets: [],
        problem:
          error instanceof Error && error.message.startsWith("В файле")
            ? error.message
            : "Файл виджетов проекта повреждён",
      };
    }
    return {
      projectId,
      path: root,
      file: real,
      exists: true,
      trusted: trust.projects[root]?.hash === hash,
      hash,
      widgets,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        projectId,
        path: root,
        file,
        exists: false,
        trusted: false,
        widgets: [],
      };
    return {
      projectId,
      path: root,
      file,
      exists: false,
      trusted: false,
      widgets: [],
      problem: error instanceof Error ? error.message : "Не удалось прочитать виджеты проекта",
    };
  }
}

/** Trusts (or stops trusting) the current contents of the project's widgets file. */
export async function setProjectWidgetTrust(
  projectId: string,
  trusted: boolean,
): Promise<ProjectWidgetState> {
  const state = await projectWidgetState(projectId);
  if (trusted && !state.exists) throw new Error("В проекте нет файла виджетов");
  if (trusted && (!state.hash || state.problem))
    throw new Error("Файлу виджетов проекта нельзя доверять");
  const task = queue.then(async () => {
    const file = await readTrust();
    if (trusted) file.projects[state.path] = { hash: state.hash!, at: new Date().toISOString() };
    else delete file.projects[state.path];
    await writeTrust(file);
    return projectWidgetState(projectId);
  });
  queue = task.catch(() => undefined);
  return task;
}

/** Only the trusted definitions of a project reach the prompt, the client and describe_widget. */
export async function trustedProjectWidgets(
  projectId: string | undefined,
): Promise<ProjectWidgetDefinition[]> {
  if (!projectId) return [];
  try {
    const state = await projectWidgetState(projectId);
    return state.trusted ? state.widgets : [];
  } catch {
    return [];
  }
}

function forbiddenDataPath(path: string): boolean {
  return path
    .split(/[\\/]/)
    .some(
      (segment) =>
        SECRET_NAMES.has(segment.toLowerCase()) ||
        SECRET_PATTERNS.some((pattern) => pattern.test(segment)),
    );
}

async function readDataFile(root: string, path: string): Promise<unknown> {
  if (forbiddenDataPath(path)) throw new Error("Файл данных похож на секрет");
  const real = await safeProjectFile(root, resolve(root, path));
  if (forbiddenDataPath(relative(root, real))) throw new Error("Файл данных похож на секрет");
  const info = await stat(real);
  if (!info.isFile()) throw new Error("Это не файл");
  if (info.size > DATA_LIMIT) throw new Error("Файл данных больше 1 МБ");
  return JSON.parse(await readFile(real, "utf8"));
}

/** Values of the project-relative JSON files a widget declared, read only while its file is trusted. */
export async function projectWidgetData(
  projectId: string,
  name: string,
): Promise<ProjectWidgetData> {
  const state = await projectWidgetState(projectId);
  if (!state.trusted) throw new Error("Файл виджетов проекта не доверен");
  const widget = state.widgets.find((item) => item.name === name);
  if (!widget) throw new Error(`Нет виджета ${name}`);
  const data: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [key, path] of Object.entries(widget.data ?? {})) {
    try {
      data[key] = await readDataFile(state.path, path);
    } catch (error) {
      errors[key] = error instanceof Error ? error.message : "Не удалось прочитать данные";
    }
  }
  return { data, errors };
}
