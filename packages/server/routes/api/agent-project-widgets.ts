import {
  projectWidgetData,
  projectWidgetState,
  setProjectWidgetTrust,
} from "../../modules/project-widgets/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { asString, json, readBody } from "../../modules/transport/index.ts";
import type { RouteContext, RouteDefinition } from "../../modules/transport/index.ts";

const pageOnly = (req: RouteContext["req"], change = false) => {
  if (!accessAllowed(req, change))
    throw new HttpError(403, "Виджеты проекта доступны только со страницы Projector");
};

function projectIdOf(value: unknown): string {
  const id = asString(value).trim();
  if (!id) throw new HttpError(400, "Укажите projectId");
  return id;
}

/** Widgets stored in a project's `.projector/widgets.json`, their data files and the trust decision. */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/agent/project-widgets",
    handler: async ({ req, res, url }) => {
      pageOnly(req);
      res.setHeader("Cache-Control", "no-store");
      try {
        json(res, 200, await projectWidgetState(projectIdOf(url.searchParams.get("projectId"))));
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Неверный проект");
      }
    },
  },
  {
    method: "PUT",
    path: "/api/agent/project-widgets/trust",
    handler: async ({ req, res }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req);
      if (typeof body.trusted !== "boolean")
        throw new HttpError(400, "trusted должен быть boolean");
      try {
        json(res, 200, await setProjectWidgetTrust(projectIdOf(body.projectId), body.trusted));
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : "Неверное доверие");
      }
    },
  },
  {
    method: "GET",
    path: "/api/agent/project-widgets/data",
    handler: async ({ req, res, url }) => {
      pageOnly(req);
      res.setHeader("Cache-Control", "no-store");
      const name = asString(url.searchParams.get("widget")).trim();
      if (!name) throw new HttpError(400, "Укажите widget");
      try {
        json(
          res,
          200,
          await projectWidgetData(projectIdOf(url.searchParams.get("projectId")), name),
        );
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Данные недоступны");
      }
    },
  },
];
