import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { dataDir } from "@projector-ai/core/modules/app-paths/index.ts";
import type { Project } from "@projector-ai/core/modules/project/index.ts";
import type { ProjectorApi } from "../api/index.ts";

const PROJECTS_FILE = () => join(dataDir(), "projects.json");

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
  return value;
}

function absolutePath(value: string): string {
  return resolve(expandHome(value));
}

function looksLikePath(value: string): boolean {
  return (
    value === "." ||
    value === ".." ||
    value.startsWith("/") ||
    value.startsWith("~") ||
    value.startsWith(".") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes("/") ||
    value.includes("\\")
  );
}

function samePath(left: string, right: string): boolean {
  const a = absolutePath(left);
  const b = absolutePath(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function insideProject(path: string, root: string): boolean {
  const parent = absolutePath(root).replace(/[\\/]+$/, "");
  const child = absolutePath(path);
  return child === parent || child.startsWith(`${parent}${sep}`);
}

function isReference(value: string): boolean {
  return (
    value.startsWith("gh:/") ||
    value.startsWith("gl:") ||
    value.startsWith("project:") ||
    value.startsWith("path:")
  );
}

function norm(value: string): string {
  return value.toLocaleLowerCase();
}

/** Works without the server: the CLI must be able to list projects while it is stopped. */
export async function readStoredProjects(): Promise<Project[]> {
  try {
    const parsed = JSON.parse(await readFile(PROJECTS_FILE(), "utf8")) as {
      projects?: Project[];
    };
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw new Error(
      `Не удалось прочитать ${PROJECTS_FILE()}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function projectsFor(api: ProjectorApi): Promise<Project[]> {
  if (await api.health()) return (await api.projects()).projects;
  return readStoredProjects();
}

export function selectProject(
  projects: readonly Project[],
  target?: string,
  options: { containing?: boolean } = {},
): Project | undefined {
  const value = target ?? process.cwd();
  const exact = projects.find(
    (project) =>
      project.id === value || norm(project.name) === norm(value) || samePath(project.path, value),
  );
  if (exact) return exact;
  const candidate = absolutePath(value);
  if (!target || (options.containing && looksLikePath(target))) {
    return projects
      .filter((project) => insideProject(candidate, project.path))
      .sort((left, right) => right.path.length - left.path.length)[0];
  }
  return undefined;
}

export async function resolveProject(api: ProjectorApi, target?: string): Promise<Project> {
  const projects = await projectsFor(api);
  const project = selectProject(projects, target, { containing: true });
  if (project) return project;
  const value = target ?? process.cwd();
  if (target && looksLikePath(target))
    throw new Error(
      `Проект не зарегистрирован: ${absolutePath(target)}. Откройте его: projector open ${target}`,
    );
  throw new Error(`Проект не найден: ${value}`);
}

export async function resolveOpenTarget(api: ProjectorApi, target: string): Promise<string> {
  if (isReference(target)) return target;
  const projects = await projectsFor(api);
  const project = selectProject(projects, target);
  if (project) return `project:${project.id}`;
  const path = absolutePath(target);
  if (existsSync(path)) {
    if (!statSync(path).isDirectory()) throw new Error(`Это не папка: ${path}`);
    return `path:${path}`;
  }
  if (looksLikePath(target)) throw new Error(`Папка не найдена: ${path}`);
  throw new Error(`Проект не найден: ${target}`);
}

export function projectState(project: Project): string {
  const status = project.runtime?.status;
  if (status === "starting") return "запускается";
  if (status === "running") return "работает";
  if (status === "stopping") return "останавливается";
  if (status === "error") return "ошибка";
  return "остановлен";
}

export function projectUrl(project: Project): string {
  return project.runtime?.url || project.url || "";
}
