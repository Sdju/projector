import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Project } from "./types.ts";

function storePath(): string {
  const root = process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share");
  return join(root, "projector", "projects.json");
}

export async function loadProjects(): Promise<Project[]> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as { projects?: Project[] };
    return (parsed.projects ?? []).map((item) => ({
      ...item,
      icon: item.icon ?? "",
    }));
  } catch {
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
