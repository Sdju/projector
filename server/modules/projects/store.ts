import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dataDir } from "../../../core/modules/app-paths/index.ts";
import { dirname, join } from "node:path";
import type { Project } from "./types.ts";

function storePath(): string {
  return join(dataDir(), "projects.json");
}

export async function loadProjects(strict = false): Promise<Project[]> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as { projects?: Project[] };
    return (parsed.projects ?? []).map((item) => ({
      ...item,
      icon: item.icon ?? "",
    }));
  } catch (error) {
    if (strict && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [];
  }
}

export async function saveProjects(projects: Project[]): Promise<void> {
  const file = storePath();
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ projects }, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

let projectWrites = Promise.resolve();
export async function updateProjects(update: (projects: Project[]) => void): Promise<void> {
  const operation = projectWrites.then(async () => {
    const projects = await loadProjects();
    update(projects);
    await saveProjects(projects);
  });
  projectWrites = operation.catch(() => {});
  await operation;
}

export async function findProject(id: string): Promise<Project | undefined> {
  return (await loadProjects()).find((item) => item.id === id);
}
