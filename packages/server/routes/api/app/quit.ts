import { appUrl } from "@projector/core/modules/app-paths/index.ts";

import { quitDesktop } from "../../../modules/window/index.ts";

import { json, type RouteDefinition } from "../../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "POST",
    path: "/api/app/quit",
    handler: async ({ res }) => {
      await quitDesktop(appUrl());
      json(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 100).unref();
    },
  },
];
