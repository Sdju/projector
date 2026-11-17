import { accessAllowed, isLocalRequest } from "../../modules/access/index.ts";
import {
  configureHub,
  hubPresence,
  hubStatus,
  requestHubLoginLink,
} from "../../modules/hub/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { json, readBody, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    // Hub serves the same path to pages outside this machine. Locally the connector answers
    // from its last snapshot, so a page on this machine can list the other devices too.
    method: "GET",
    path: "/api/hub/devices",
    handler: ({ req, res }) => {
      // Read-only: a same-origin GET carries no Origin, so only a foreign one is rejected.
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Доступно только со страницы Projector");
      const { enabled, online, url, deviceId, error, relay } = hubStatus();
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, {
        enabled,
        online,
        url,
        deviceId,
        error,
        local: true,
        relay: isLocalRequest(req) && relay,
        ...hubPresence(),
      });
    },
  },
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
