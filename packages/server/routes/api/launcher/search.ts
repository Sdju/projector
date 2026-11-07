import { launchDetail, searchLauncher } from "../../../modules/launcher/index.ts";

import { json, type RouteDefinition } from "../../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/launcher/search",
    handler: async ({ res, url }) => {
      const query = url.searchParams.get("q") ?? "";
      const disk = url.searchParams.get("disk") !== "0";
      json(res, 200, await searchLauncher(query, { disk }));
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
