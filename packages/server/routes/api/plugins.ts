import { pipeline } from "node:stream/promises";
import {
  discoverPlugins,
  installPlugin,
  openPluginAsset,
  removePlugin,
  setPluginEnabled,
  trustPlugin,
} from "../../modules/plugins/index.ts";
import { pluginPackageName } from "@ai-projector/core/modules/plugins/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { asString, json, readBody, type RouteDefinition } from "../../modules/transport/index.ts";

const assetPath = "/api/plugins/assets/:key/:hash/**";

export const routes: RouteDefinition[] = [
  {
    method: ["GET", "HEAD"],
    path: assetPath,
    handler: async ({ req, res, method, params }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const name = pluginPackageName(params.key ?? "");
      let relative: string;
      try {
        relative = (params["0"] ?? "").split("/").map(decodeURIComponent).join("/");
      } catch {
        throw new HttpError(400, "Некорректный путь ассета");
      }
      const catalog = await discoverPlugins();
      const plugin = name ? catalog.plugins.find((item) => item.id === name) : undefined;
      const asset = await openPluginAsset(plugin, params.hash ?? "", relative);
      if (!asset) {
        json(res, 404, { error: "Ассет плагина недоступен" });
        return;
      }
      res.setHeader("Content-Type", asset.type);
      res.setHeader("Content-Length", asset.size);
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      if (method === "HEAD") {
        asset.stream.destroy();
        res.end();
        return;
      }
      await pipeline(asset.stream, res).catch(() => res.destroy());
    },
  },
  {
    method: "",
    path: assetPath,
    handler: ({ req, res }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(res, 405, { error: "Допустим только GET" });
    },
  },
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
