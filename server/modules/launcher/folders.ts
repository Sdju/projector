import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HttpError } from "../http/index.ts";
import { expandPath, inspectProject, loadProjects, updateProjects } from "../projects/index.ts";
import type { Project } from "../projects/index.ts";
import { normalizeProject } from "../project-presentation/index.ts";
import { preferences, setFavoriteDirectory } from "../preferences/index.ts";
import type { LaunchItem } from "../../../core/modules/launcher/index.ts";
import { tildePath, workspaceRoute } from "./project-entries.ts";

export { workspaceRoute };

/** Launcher id `new:<folder>\n<path>` → its parts. */
export function parseNewId(id: string): { folder: string; segments: string[] } {
  const [folder = "", path = ""] = id.slice(4).split("\n");
  return { folder, segments: projectPath(path) };
}

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

/** Splits `new/…` text into plain folder names; every segment is validated like a project name. */
export function projectPath(text: string): string[] {
  const segments = text
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!segments.length) throw new HttpError(400, "Укажите имя проекта");
  return segments.map(validProjectName);
}

const newId = (folder: string, segments: string[]) => `new:${folder}\n${segments.join("/")}`;

/**
 * `new/имя` results. One favorite folder creates the project right away; several folders are
 * offered as choices, so the user says where the project goes.
 */
export async function creationItems(
  text: string,
  folders: string[],
): Promise<{ items: LaunchItem[]; warning?: string }> {
  if (!folders.length)
    return {
      items: [],
      warning: "Нет избранных папок: добавьте папку в карточке проекта или в настройках",
    };
  if (!text) return { items: [], warning: "Введите имя проекта: new/имя или new/группа/имя" };
  let segments: string[];
  try {
    segments = projectPath(text);
  } catch (error) {
    return { items: [], warning: error instanceof Error ? error.message : String(error) };
  }
  const items: LaunchItem[] = [];
  for (const folder of folders) {
    if (!(await isDirectory(folder))) continue;
    const exists = await isDirectory(join(folder, ...segments));
    items.push({
      id: newId(folder, segments),
      name: folders.length > 1 ? tildePath(folder) : `Создать «${segments.join("/")}»`,
      kind: "directory",
      description: exists
        ? "такая папка уже существует"
        : folders.length > 1
          ? `создать «${segments.join("/")}» здесь`
          : `новый проект в ${tildePath(folder)}`,
      keywords: "",
      actions: exists ? [] : [{ id: "create", title: "Создать проект" }],
    });
  }
  return {
    items,
    warning: items.length > 1 ? `В какой папке создать «${segments.join("/")}»?` : undefined,
  };
}

/** Creates the folder, registers it as a project and returns its workspace route. */
export async function createProjectIn(
  parent: string,
  segments: string[],
): Promise<{ project: Project; route: string }> {
  if (!(await preferences()).directories.includes(parent))
    throw new HttpError(400, "Создавать проекты можно только в избранных папках");
  if (!(await isDirectory(parent))) throw new HttpError(400, "Избранная папка не найдена");
  const path = join(await realpath(parent), ...segments);
  try {
    await mkdir(dirname(path), { recursive: true });
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
