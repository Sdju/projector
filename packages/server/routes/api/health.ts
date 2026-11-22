import { appUrl, readNetworkMode } from "@ai-projector/core/modules/app-paths/index.ts";

import { hasLanPassword, lanUrl } from "../../modules/access/index.ts";
import { readInstalledApp } from "../../modules/app-update/index.ts";

import { json, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/health",
    handler: ({ res }) => {
      const { projectorRuntimeMode: mode } = globalThis as { projectorRuntimeMode?: string };
      const installed = readInstalledApp();
      json(res, 200, {
        ok: true,
        app: "projector",
        pid: process.pid,
        url: appUrl(),
        mode,
        version: installed.version,
        source: installed.source,
        network: { mode: readNetworkMode(), passwordRequired: hasLanPassword(), lanUrl: lanUrl() },
      });
    },
  },
];
