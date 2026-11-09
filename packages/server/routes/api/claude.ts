import { claudeUsage } from "../../modules/agents-integration/claude/index.ts";
import { recordAgentLimits } from "../../modules/usage-analytics/index.ts";
import { json, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/claude/usage",
    handler: async ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      const value = await claudeUsage();
      recordAgentLimits("claude", value);
      json(res, 200, value);
    },
  },
];
