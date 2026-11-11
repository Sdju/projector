import {
  discoverPlugins,
  installPlugin,
  removePlugin,
  setPluginEnabled,
  trustPlugin,
} from "../../modules/plugins/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { asString, json, readBody, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/plugins",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await discoverPlugins());
    },
  },
  {
    method: "POST",
    path: "/api/plugins",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, true))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req);
      const action = asString(body.action);
      if (action === "refresh") json(res, 200, await discoverPlugins());
      else if (action === "enable") json(res, 200, await setPluginEnabled(asString(body.id), true));
      else if (action === "disable")
        json(res, 200, await setPluginEnabled(asString(body.id), false));
      else if (action === "install") json(res, 200, await installPlugin(body.path));
      else if (action === "trust") json(res, 200, await trustPlugin(asString(body.id)));
      else if (action === "remove") json(res, 200, await removePlugin(asString(body.id)));
      else throw new HttpError(400, "Неизвестное действие с плагином");
    },
  },
  {
    method: "",
    path: "/api/plugins",
    handler: ({ req, res }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(res, 405, { error: "Метод не поддерживается" });
    },
  },
];
