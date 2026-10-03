import {
  dockerSnapshot,
  configureDocker,
  bindDocker,
  dockerAction,
  dockerLogs,
} from "../../modules/docker/index.ts";
import { findProject } from "../../modules/projects/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { json, readBody, type RouteContext } from "../../modules/transport/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";

export async function handleDocker({ req, res, url, method, path }: RouteContext) {
  if (path !== "/api/docker" && !path.startsWith("/api/docker/")) return false;
  res.setHeader("Cache-Control", "no-store");
  if (method !== "GET" && !accessAllowed(req, true))
    throw new HttpError(403, "Docker-действия доступны со страницы Projector");
  const projectId = url.searchParams.get("projectId");
  const project = projectId ? await findProject(projectId) : undefined;
  if (projectId && !project) throw new HttpError(404, "Проект не найден");
  if (path === "/api/docker" && method === "GET") {
    json(
      res,
      200,
      await dockerSnapshot(project ?? undefined, url.searchParams.get("context") ?? undefined),
    );
  } else if (path === "/api/docker/settings" && method === "PUT") {
    json(res, 200, await configureDocker(await readBody(req)));
  } else if (path === "/api/docker/binding" && method === "PUT") {
    if (!project) throw new HttpError(400, "Укажите projectId");
    json(res, 200, { binding: await bindDocker(project.id, project.path, await readBody(req)) });
  } else if (path === "/api/docker/action" && method === "POST") {
    if (!project) throw new HttpError(400, "Укажите projectId");
    json(res, 201, await dockerAction(project, await readBody(req)));
  } else if (path === "/api/docker/logs" && method === "GET") {
    json(
      res,
      200,
      await dockerLogs(
        url.searchParams.get("context") ?? "",
        url.searchParams.get("containerId") ?? "",
      ),
    );
  } else return false;
  return true;
}
