import { appUrl } from "@ai-projector/core/modules/app-paths/index.ts";

import { openLauncher, openRoute, startTray } from "../../../modules/window/index.ts";
import { interfaceMode } from "../../../modules/launcher/index.ts";
import { HttpError } from "../../../modules/http/index.ts";

import { json, readBody, type RouteDefinition } from "../../../modules/transport/index.ts";
import { notifyLauncherShow } from "../../../modules/events/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "POST",
    path: "/api/app/open",
    handler: async ({ req, res }) => {
      const body = await readBody(req);
      if (body.tray === true) {
        await startTray(appUrl());
        json(res, 200, { ok: true });
        return;
      }
      const route = typeof body.route === "string" ? body.route : "";
      if (route) {
        if (!route.startsWith("/") || route.startsWith("//"))
          throw new HttpError(400, "Маршрут должен быть путём внутри Projector");
        const mode = await openRoute(
          appUrl(),
          route,
          body.mode ? interfaceMode(body.mode) : undefined,
        );
        json(res, 200, { ok: true, url: `${appUrl()}${route}`, mode });
        return;
      }
      const mode = await openLauncher(
        appUrl(),
        body.mode ? interfaceMode(body.mode) : undefined,
        body.toggle === true,
      );
      if (mode === "window") {
        notifyLauncherShow();
      }
      json(res, 200, { ok: true, url: appUrl(), mode });
    },
  },
];
