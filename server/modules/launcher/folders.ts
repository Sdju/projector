import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { HttpError } from "../http/index.ts";
import { expandPath, inspectProject, loadProjects, updateProjects } from "../projects/index.ts";
import type { Project } from "../projects/index.ts";
import { normalizeProject } from "../project-presentation/index.ts";
import { preferences, setFavoriteDirectory } from "../preferences/index.ts";
import type { LaunchAction, LaunchItem } from "../../../core/modules/launcher/index.ts";
import { tildePath, workspaceRoute } from "./project-entries.ts";

export { workspaceRoute };

const normalize = (value: string) =>
  value.toLocaleLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

/** True when the project folder is a direct child of a favorite folder. */
export const inFavoriteFolder = (project: Pick<Project, "path">, folders: string[]) =>
  folders.includes(dirname(expandPath(project.path)));

/** A new project is a single plain folder name: no separators, no dot-folders. */
export function validProjectName(name: string): string {
  const value = name.trim();
  if (!value || value.length > 100 || /[\\/\0:*?"<>|]/.test(value) || value.startsWith("."))
    throw new HttpError(
      400,
      'Имя проекта не должно быть пустым, начинаться с точки или содержать / \\ : * ? " < > |',
    );
  return value;
}

async function isDirectory(path: string) {
  return stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );
}

/** Resolves and checks a folder before it becomes a favorite. */
export async function favoriteFolderPath(input: string): Promise<string> {
  if (!input.trim()) throw new HttpError(400, "Укажите папку");
  const path = expandPath(input.trim());
  if (!(await isDirectory(path))) throw new HttpError(400, "Папка не найдена");
  return realpath(path);
}

/** Folder results: first in the palette, they show how many projects they hold. */
export async function folderItems(folders: string[], projects: Project[]): Promise<LaunchItem[]> {
  const present: LaunchItem[] = [];
  for (const path of folders) {
    if (!(await isDirectory(path))) continue;
    const count = projects.filter((project) => dirname(expandPath(project.path)) === path).length;
    present.push({
      id: `dir:${path}`,
      name: basename(path) || path,
      kind: "directory",
      description: `папка · ${tildePath(path)} · проектов: ${count} · «${basename(path)}/имя» создаёт проект`,
      keywords: path,
      favorite: true,
      actions: [
        { id: "open", title: "Открыть папку" },
        { id: "folder", title: "Убрать из избранных папок" },
      ],
    });
  }
  return present;
}

/**
 * `папка/имя` creates a project: the head picks a favorite folder by name, the tail names the
 * new project. An existing folder is offered as nothing, never overwritten.
 */
export function creationItems(text: string, folders: string[]): LaunchItem[] {
  const slash = text.indexOf("/");
  if (slash <= 0) return [];
  const head = normalize(text.slice(0, slash).trim());
  const name = text.slice(slash + 1).trim();
  if (!head || !name) return [];
  try {
    validProjectName(name);
  } catch {
    return [];
  }
  return folders
    .filter((folder) => normalize(basename(folder)).startsWith(head))
    .map((folder) => ({
      id: `new:${join(folder, name)}`,
      name: `Создать проект «${name}»`,
      kind: "directory" as const,
      description: `новая папка в ${tildePath(folder)}`,
      keywords: "",
      section: "folders" as const,
      actions: [{ id: "create", title: "Создать проект" } satisfies LaunchAction],
    }));
}

/** Creates the folder, registers it as a project and returns its workspace route. */
export async function createProjectIn(
  target: string,
): Promise<{ project: Project; route: string }> {
  const parent = dirname(target);
  const name = validProjectName(basename(target));
  if (!(await preferences()).directories.includes(parent))
    throw new HttpError(400, "Создавать проекты можно только в избранных папках");
  if (!(await isDirectory(parent))) throw new HttpError(400, "Избранная папка не найдена");
  const path = join(await realpath(parent), name);
  try {
    await mkdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new HttpError(409, "Такая папка уже существует");
    throw error;
  }
  const project = normalizeProject({ ...(await inspectProject(path, true)) });
  await updateProjects((projects) => {
    if (!projects.some((item) => expandPath(item.path) === path)) projects.unshift(project);
  });
  const stored = (await loadProjects()).find((item) => expandPath(item.path) === path) ?? project;
  return { project: stored, route: workspaceRoute(path) };
}

export { setFavoriteDirectory };
