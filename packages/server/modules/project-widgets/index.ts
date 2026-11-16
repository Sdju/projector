import { readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  normalizeProjectWidget,
  PROJECT_WIDGET_LIMITS,
  type ProjectWidgetData,
  type ProjectWidgetDefinition,
  type ProjectWidgetState,
} from "@ai-projector/core/modules/widget-catalog/index.ts";
import {
  createTrustStore,
  projectTrustDescriptor,
  readTrustedProjectFile,
  safeProjectFile,
  trustStateOf,
  type ProjectTrustDescriptor,
  type TrustedProjectFile,
  type TrustedProjectFileSpec,
  type TrustRecord,
} from "../trusted-project-file/index.ts";

/** Widgets a project keeps in its repository; inert until the user trusts this exact file. */
export const projectWidgetsRelativeFile = ".projector/widgets.json";
export const projectWidgetsTrustFile = () => join(dataDir(), "agent", "widget-trust.json");

/** A data file is read only on behalf of a trusted widget and never from a secret-looking path. */
const DATA_LIMIT = 1_000_000;
const SECRET_NAMES = new Set([".ssh", ".aws", ".npmrc", ".netrc", ".git-credentials", ".git"]);
const SECRET_PATTERNS = [/(^\.|\.)env($|\.)/i, /\.(pem|key)$/i, /^id_(rsa|ed25519)/i, /\.kdbx$/i];

interface WidgetTrustEntry extends TrustRecord {
  at: string;
}

const widgetsTrust = createTrustStore<WidgetTrustEntry>({
  file: projectWidgetsTrustFile,
  fields: ["hash", "at"],
});

const widgetsFile = (
  projectId: string,
): TrustedProjectFileSpec<ProjectWidgetDefinition[], WidgetTrustEntry> => ({
  projectId,
  relativeFile: projectWidgetsRelativeFile,
  trust: widgetsTrust,
  parse: widgetsOf,
  fallback: [],
  escape: "Файл виджетов проекта указывает за его пределы",
  unreadable: "Не удалось прочитать виджеты проекта",
});

/** Состояние виджетов проекта: файл, его хеш и решение пользователя. */
function widgetState(projectId: string, file: TrustedProjectFile<ProjectWidgetDefinition[]>) {
  const state: ProjectWidgetState = {
    projectId,
    path: file.root,
    file: file.file,
    exists: file.exists,
    trusted: file.trusted,
    widgets: file.value,
  };
  if (file.hash) state.hash = file.hash;
  if (file.problem) state.problem = file.problem;
  return state;
}

function widgetsOf(text: string): ProjectWidgetDefinition[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Файл виджетов проекта повреждён");
  }
  const widgets = (value as { widgets?: unknown })?.widgets;
  if (!Array.isArray(widgets)) throw new Error("В файле виджетов проекта нет widgets");
  const rows = widgets
    .slice(0, PROJECT_WIDGET_LIMITS.widgets)
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  const names = rows.flatMap((row) =>
    typeof row.name === "string" && row.name.trim() ? [row.name.trim()] : [],
  );
  const result: ProjectWidgetDefinition[] = [];
  for (const row of rows) {
    const widget = normalizeProjectWidget(row, names);
    if (!widget || result.some((known) => known.name === widget.name)) continue;
    result.push(widget);
  }
  return result;
}

/** The project's widgets file and its trust decision; a broken or unsafe file is reported, not used. */
export async function projectWidgetState(projectId: string): Promise<ProjectWidgetState> {
  return widgetState(projectId, await readTrustedProjectFile(widgetsFile(projectId)));
}

/** Вид доверия к виджетам проекта для реестра `project-trust`. */
export const projectWidgetTrustDescriptor: ProjectTrustDescriptor = projectTrustDescriptor(
  "widgets",
  widgetsTrust,
  async (projectId) => trustStateOf(await readTrustedProjectFile(widgetsFile(projectId))),
);

/** Trusts (or stops trusting) the current contents of the project's widgets file. */
export async function setProjectWidgetTrust(
  projectId: string,
  trusted: boolean,
): Promise<ProjectWidgetState> {
  const state = await projectWidgetState(projectId);
  if (trusted && !state.exists) throw new Error("В проекте нет файла виджетов");
  if (trusted && (!state.hash || state.problem))
    throw new Error("Файлу виджетов проекта нельзя доверять");
  await widgetsTrust.set(
    state.path,
    trusted ? { hash: state.hash!, at: new Date().toISOString() } : null,
  );
  return projectWidgetState(projectId);
}

/** Only the trusted definitions of a project reach the prompt and the client. */
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
  const real = await safeProjectFile(
    root,
    resolve(root, path),
    "Файл виджетов проекта указывает за его пределы",
  );
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
