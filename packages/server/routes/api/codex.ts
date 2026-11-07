import { codexUsage } from "../../modules/agents-integration/codex/index.ts";
import { json, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/codex/usage",
    handler: async ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await codexUsage());
    },
  },
];
