import { appUrl, readNetworkMode } from "@projector/core/modules/app-paths/index.ts";

import { hasLanPassword, lanUrl } from "../../modules/access/index.ts";

import { json, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/health",
    handler: ({ res }) => {
      const { projectorRuntimeMode: mode } = globalThis as { projectorRuntimeMode?: string };
      json(res, 200, {
        ok: true,
        app: "projector",
        pid: process.pid,
        url: appUrl(),
        mode,
        network: { mode: readNetworkMode(), passwordRequired: hasLanPassword(), lanUrl: lanUrl() },
      });
    },
  },
];
