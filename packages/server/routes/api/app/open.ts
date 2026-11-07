import { appUrl } from "@projector/core/modules/app-paths/index.ts";

import { openLauncher, startTray } from "../../../modules/window/index.ts";
import { interfaceMode } from "../../../modules/launcher/index.ts";

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
