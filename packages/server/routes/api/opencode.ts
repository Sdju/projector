import { openCodeUsage } from "../../modules/agents-integration/opencode/index.ts";
import { json, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/opencode/usage",
    handler: async ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await openCodeUsage());
    },
  },
];
