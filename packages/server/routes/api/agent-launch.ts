import {
  acpLaunchSettings,
  resetAcpLaunchOverride,
  setAcpLaunchOverride,
} from "../../modules/agents/acp/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { json, readBody } from "../../modules/transport/index.ts";
import type { RouteContext, RouteDefinition } from "../../modules/transport/index.ts";

const pageOnly = (req: RouteContext["req"], change = false) => {
  if (!accessAllowed(req, change))
    throw new HttpError(403, "Настройки запуска доступны только со страницы Projector");
};

function agentId(params: Record<string, string | undefined>): string {
  const id = decodeURIComponent(params.id ?? "").trim();
  if (!id) throw new HttpError(400, "Укажите агента");
  return id;
}

function badRequest(error: unknown): never {
  if (error instanceof HttpError) throw error;
  throw new HttpError(400, error instanceof Error ? error.message : "Неверная настройка запуска");
}

/** Machine-local ACP launch overrides: what command each registered ACP backend starts. */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/agent/launch",
    handler: ({ req, res }) => {
      pageOnly(req);
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, acpLaunchSettings());
    },
  },
  {
    method: "PUT",
    path: "/api/agent/launch/:id",
    handler: async ({ req, res, params }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const id = agentId(params);
      try {
        json(res, 200, await setAcpLaunchOverride(id, await readBody(req, 1024 * 1024)));
      } catch (error) {
        badRequest(error);
      }
    },
  },
  {
    method: "DELETE",
    path: "/api/agent/launch/:id",
    handler: async ({ req, res, params }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const id = agentId(params);
      try {
        json(res, 200, await resetAcpLaunchOverride(id));
      } catch (error) {
        badRequest(error);
      }
    },
  },
];
