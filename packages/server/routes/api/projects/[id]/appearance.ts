import {
  projectAppearanceState,
  setProjectAppearanceTrust,
  writeProjectAppearance,
} from "../../../../modules/project-appearance/index.ts";
import { accessAllowed } from "../../../../modules/access/index.ts";
import { auditProjectTrust } from "../../../../modules/project-trust/index.ts";
import { HttpError } from "../../../../modules/http/index.ts";
import {
  json,
  readBody,
  type RouteContext,
  type RouteDefinition,
} from "../../../../modules/transport/index.ts";

const pageOnly = (req: RouteContext["req"], change = false) => {
  if (!accessAllowed(req, change))
    throw new HttpError(403, "Оформление проекта доступно только со страницы Projector");
};

/** Project `.projector/appearance.json`: colour scheme and font overrides with a trust gate. */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/projects/:id/appearance",
    handler: async ({ req, res, params }) => {
      pageOnly(req);
      res.setHeader("Cache-Control", "no-store");
      try {
        json(res, 200, await projectAppearanceState(params.id));
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Неверный проект");
      }
    },
  },
  {
    method: "PUT",
    path: "/api/projects/:id/appearance",
    handler: async ({ req, res, params }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req);
      try {
        const state = await writeProjectAppearance(params.id, body);
        void auditProjectTrust(params.id);
        json(res, 200, state);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : "Не удалось сохранить");
      }
    },
  },
  {
    method: "PUT",
    path: "/api/projects/:id/appearance/trust",
    handler: async ({ req, res, params }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req);
      if (typeof body.trusted !== "boolean")
        throw new HttpError(400, "trusted должен быть boolean");
      try {
        const state = await setProjectAppearanceTrust(params.id, body.trusted);
        void auditProjectTrust(params.id);
        json(res, 200, state);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : "Неверное доверие");
      }
    },
  },
];
