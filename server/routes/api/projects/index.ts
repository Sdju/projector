import { stat } from "node:fs/promises";
import {
  loadProjects,
  updateProjects,
  expandPath,
  inspectProject,
  type Project,
} from "../../../modules/projects/index.ts";
import { HttpError } from "../../../modules/http/index.ts";

import { json, readBody } from "../../../modules/transport/index.ts";

import { normalizeProject, withRuntime } from "../../../modules/project-presentation/index.ts";
import type { RouteContext } from "../../../modules/transport/index.ts";

export async function handleProjectsIndex({
  req,
  res,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (path === "/api/projects/resolve" && method === "POST") {
    const body = await readBody(req);
    if (typeof body.path !== "string" || !body.path.trim())
      throw new HttpError(400, "Укажите путь к проекту");
    const directory = expandPath(body.path);
    const existing = (await loadProjects()).find((item) => expandPath(item.path) === directory);
    if (existing) {
      // A saved project outlives its folder: report it so the UI can offer recovery.
      const missing = !(await stat(directory).then(
        (info) => info.isDirectory(),
        () => false,
      ));
      json(res, 200, { project: withRuntime({ ...existing, path: directory }), missing });
      return true;
    }
    const draft = await inspectProject(directory, true);
    const candidate = normalizeProject({ ...draft });
    let project: Project = candidate;
    await updateProjects((projects) => {
      // Serialize duplicate opens so that terminals and settings share one ID.
      const current = projects.find((item) => expandPath(item.path) === directory);
      if (current) project = { ...current, path: directory };
      else projects.unshift(candidate);
    });
    json(res, 200, { project: withRuntime(project) });
    return true;
  }
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
