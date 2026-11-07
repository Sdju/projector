import { claudeUsage } from "../../modules/agents-integration/claude/index.ts";
import { json, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/claude/usage",
    handler: async ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await claudeUsage());
    },
  },
];
