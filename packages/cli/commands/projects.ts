import type { Project } from "@projector-ai/core/modules/project/index.ts";
import { writeJson, printTable, type Output } from "../common/output.ts";
import type { CliOptions } from "../modules/arguments/index.ts";
import type { ProjectorApi } from "../modules/api/index.ts";
import { projectState, readStoredProjects } from "../modules/projects/index.ts";

export async function commandProjects(
  api: ProjectorApi,
  options: CliOptions,
  out: Output,
): Promise<Project[]> {
  const online = await api.health();
  const projects = online ? (await api.projects()).projects : await readStoredProjects();
  if (options.json) {
    writeJson(out, { source: online ? "server" : "disk", projects });
    return projects;
  }
  if (!projects.length) {
    if (!options.quiet) out("Проектов пока нет. Откройте папку: projector open <путь>");
    return projects;
  }
  if (!options.quiet)
    printTable(
      ["ID", "ИМЯ", "СОСТОЯНИЕ", "ПУТЬ"],
      projects.map((project) => [project.id, project.name, projectState(project), project.path]),
      out,
    );
  return projects;
}
