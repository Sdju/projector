import { loadProjects, updateProjects } from "../../../modules/projects/index.ts";

import { json, readBody } from "../../../modules/transport/index.ts";

import { normalizeProject, withRuntime } from "../../../modules/project-presentation/index.ts";
import type { RouteContext } from "../../../modules/transport/index.ts";

export async function handleProjectsIndex({
  req,
  res,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (path === "/api/projects" && method === "GET") {
    const projects = await loadProjects();
    json(res, 200, { projects: projects.map(withRuntime) });
    return true;
  }
  if (path === "/api/projects" && method === "POST") {
    const body = await readBody(req);
    const project = normalizeProject(body);
    if (!project.path) throw new Error("Укажите путь к проекту");
    await updateProjects((projects) => {
      projects.unshift(project);
    });
    json(res, 201, { project: withRuntime(project) });
    return true;
  }
  return false;
}
