import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { dirname, join } from "node:path";
import type { ProjectScenarios } from "@ai-projector/core/modules/project/index.ts";
import type { Project } from "./types.ts";
import { readProjectScenarios, writeProjectScenarios } from "./scenarios.ts";

function storePath(): string {
  return join(dataDir(), "projects.json");
}

function scenariosOf(project: Project): ProjectScenarios {
  return { commands: project.commands, defaultCommandId: project.defaultCommandId };
}

const migratedScenarios = new Set<string>();

/**
 * Scenarios are read from the project itself. A project saved by an older version keeps its
 * commands in `projects.json`; they are moved to `.projector/scenarios.json` once per process.
 */
async function withScenarios(project: Project): Promise<Project> {
  let stored: ProjectScenarios | undefined;
  try {
    stored = await readProjectScenarios(project.path);
  } catch {
    // A broken or unsafe file must not make the whole catalog unreadable.
    return project;
  }
  if (stored) return { ...project, ...stored };
  if (!Array.isArray(project.commands) || project.commands.length === 0) return project;
  const legacy = scenariosOf(project);
  if (!migratedScenarios.has(project.path)) {
    migratedScenarios.add(project.path);
    await writeProjectScenarios(project.path, legacy).catch(() => {});
  }
  return project;
}

export async function loadProjects(strict = false): Promise<Project[]> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as { projects?: Project[] };
    return await Promise.all(
      (parsed.projects ?? []).map(async (item) => {
        const commands = Array.isArray(item.commands) ? item.commands : [];
        const project: Project = {
          ...item,
          icon: item.icon ?? "",
          commands,
          defaultCommandId:
            typeof item.defaultCommandId === "string" &&
            commands.some((command) => command.id === item.defaultCommandId)
              ? item.defaultCommandId
              : (commands[0]?.id ?? ""),
        };
        return withScenarios(project);
      }),
    );
  } catch (error) {
    if (strict && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [];
  }
}

/** True when the project already has a readable scenarios file. */
async function persistsScenarios(project: Project): Promise<boolean> {
  try {
    return (await readProjectScenarios(project.path)) !== undefined;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );
}

/** `projects.json` keeps only the catalog now; scenario fields live in each project's folder. */
export async function saveProjects(projects: Project[]): Promise<void> {
  const file = storePath();
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const catalog = await Promise.all(
    projects.map(async ({ commands, defaultCommandId, ...item }) => {
      // A project whose folder is gone keeps its scenarios here until recovery can write them.
      if (await persistsScenarios({ ...item, commands, defaultCommandId })) return item;
      return { ...item, commands, defaultCommandId };
    }),
  );
  await writeFile(tmp, `${JSON.stringify({ projects: catalog }, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

function scenariosChanged(before: ProjectScenarios, after: ProjectScenarios): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

let projectWrites = Promise.resolve();
export async function updateProjects(update: (projects: Project[]) => void): Promise<void> {
  const operation = projectWrites.then(async () => {
    const projects = await loadProjects();
    const before = new Map(
      projects.map((project) => [
        project.id,
        { path: project.path, scenarios: scenariosOf(project) },
      ]),
    );
    update(projects);
    // Scenario files first: a failed catalog write must not leave a project without its commands.
    for (const project of projects) {
      const previous = before.get(project.id);
      const scenarios = scenariosOf(project);
      const changed =
        !previous ||
        previous.path !== project.path ||
        scenariosChanged(previous.scenarios, scenarios);
      if (!(await isDirectory(project.path))) continue;
      if (!changed && (await persistsScenarios(project))) continue;
      await writeProjectScenarios(project.path, scenarios);
    }
    await saveProjects(projects);
  });
  projectWrites = operation.catch(() => {});
  await operation;
}

export async function findProject(id: string): Promise<Project | undefined> {
  return (await loadProjects()).find((item) => item.id === id);
}
