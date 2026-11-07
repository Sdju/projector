import {
  dockerSnapshot,
  configureDocker,
  bindDocker,
  dockerAction,
  dockerLogs,
  startDockerDaemon,
} from "../../modules/docker/index.ts";
import { findProject } from "../../modules/projects/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import {
  json,
  readBody,
  type RouteContext,
  type RouteDefinition,
} from "../../modules/transport/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";

async function dockerContext(context: RouteContext) {
  context.res.setHeader("Cache-Control", "no-store");
  if (context.method !== "GET" && !accessAllowed(context.req, true))
    throw new HttpError(403, "Docker-действия доступны со страницы Projector");
  const projectId = context.url.searchParams.get("projectId");
  const project = projectId ? await findProject(projectId) : undefined;
  if (projectId && !project) throw new HttpError(404, "Проект не найден");
  return project;
}

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/docker",
    handler: async (context) => {
      const project = await dockerContext(context);
      json(
        context.res,
        200,
        await dockerSnapshot(
          project ?? undefined,
          context.url.searchParams.get("context") ?? undefined,
        ),
      );
    },
  },
  {
    method: "PUT",
    path: "/api/docker/settings",
    handler: async (context) => {
      await dockerContext(context);
      json(context.res, 200, await configureDocker(await readBody(context.req)));
    },
  },
  {
    method: "PUT",
    path: "/api/docker/binding",
    handler: async (context) => {
      const project = await dockerContext(context);
      if (!project) throw new HttpError(400, "Укажите projectId");
      json(context.res, 200, {
        binding: await bindDocker(project.id, project.path, await readBody(context.req)),
      });
    },
  },
  {
    method: "POST",
    path: "/api/docker/action",
    handler: async (context) => {
      const project = await dockerContext(context);
      if (!project) throw new HttpError(400, "Укажите projectId");
      json(context.res, 201, await dockerAction(project, await readBody(context.req)));
    },
  },
  {
    method: "POST",
    path: "/api/docker/daemon/start",
    handler: async (context) => {
      await dockerContext(context);
      const body = (await readBody(context.req)) as { context?: unknown };
      if (typeof body.context !== "string") throw new HttpError(400, "Укажите Docker context");
      json(context.res, 200, await startDockerDaemon(body.context));
    },
  },
  {
    method: "GET",
    path: "/api/docker/logs",
    handler: async (context) => {
      await dockerContext(context);
      json(
        context.res,
        200,
        await dockerLogs(
          context.url.searchParams.get("context") ?? "",
          context.url.searchParams.get("containerId") ?? "",
        ),
      );
    },
  },
];
