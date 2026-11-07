import { launchDetail, searchLauncher } from "../../../modules/launcher/index.ts";

import { json, type RouteDefinition } from "../../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/launcher/search",
    handler: async ({ res, url }) => {
      json(res, 200, await searchLauncher(url.searchParams.get("q") ?? ""));
    },
  },
  {
    method: "GET",
    path: "/api/launcher/detail",
    handler: async ({ res, url }) => {
      json(res, 200, await launchDetail(url.searchParams.get("id") ?? ""));
    },
  },
];
