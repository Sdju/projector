import { isLocalRequest } from "../../modules/access/index.ts";
import { configureHub, hubStatus, requestHubLoginLink } from "../../modules/hub/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { json, readBody, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/hub",
    handler: ({ req, res }) => {
      if (!isLocalRequest(req)) throw new HttpError(403, "Настройки Hub доступны только локально");
      json(res, 200, hubStatus());
    },
  },
  {
    method: "PUT",
    path: "/api/hub",
    handler: async ({ req, res }) => {
      if (!isLocalRequest(req))
        throw new HttpError(403, "Подключение Hub доступно только локально");
      const body = await readBody(req);
      configureHub(body);
      json(res, 200, hubStatus());
    },
  },
  {
    method: "POST",
    path: "/api/hub/login-link",
    handler: async ({ req, res }) => {
      if (!isLocalRequest(req))
        throw new HttpError(403, "Ссылка входа Hub доступна только локально");
      json(res, 200, await requestHubLoginLink());
    },
  },
];
