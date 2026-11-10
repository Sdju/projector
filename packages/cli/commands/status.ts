import type { Project } from "@ai-projector/core/modules/project/index.ts";
import { writeJson, type Output } from "../common/output.ts";
import type { CliOptions } from "../modules/arguments/index.ts";
import type { HealthInfo, ProjectorApi } from "../modules/api/index.ts";
import { serverLine } from "../modules/command-runtime/index.ts";
import {
  projectState,
  projectUrl,
  readStoredProjects,
  selectProject,
} from "../modules/projects/index.ts";

export interface StatusResult {
  server: HealthInfo | null;
  project?: Project;
  projects?: Project[];
  running?: number;
}

export async function commandStatus(
  api: ProjectorApi,
  options: CliOptions,
  target: string | undefined,
  out: Output,
): Promise<StatusResult> {
  const info = await api.health();
  const projects = info ? (await api.projects()).projects : await readStoredProjects();
  if (target) {
    const project = selectProject(projects, target, { containing: true });
    if (!project) throw new Error(`Проект не найден: ${target}`);
    const result: StatusResult = { server: info, project };
    if (options.json) writeJson(out, result);
    else if (!options.quiet) {
      out(info ? `Сервер: работает · ${serverLine(info)}` : "Сервер: не запущен");
      out(`Проект: ${project.name}`);
      out(`Путь: ${project.path}`);
      out(`Состояние: ${projectState(project)}`);
      if (project.runtime?.commandName) out(`Команда: ${project.runtime.commandName}`);
      if (project.runtime?.pid) out(`PID: ${project.runtime.pid}`);
      const url = projectUrl(project);
      if (url) out(`Адрес: ${url}`);
    }
    return result;
  }
  const running = projects.filter((project) => project.runtime?.status === "running");
  const result: StatusResult = { server: info, projects, running: running.length };
  if (options.json) writeJson(out, result);
  else if (!options.quiet) {
    out(info ? `Сервер: работает · ${serverLine(info)}` : "Сервер: не запущен");
    out(`Проекты: ${projects.length}; работает: ${running.length}`);
    for (const project of running) {
      const url = projectUrl(project);
      out(
        `  ${project.name}${project.runtime?.pid ? ` (pid ${project.runtime.pid})` : ""}${
          url ? ` — ${url}` : ""
        }`,
      );
    }
  }
  return result;
}
