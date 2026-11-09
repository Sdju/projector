import { cursorUsage } from "../../modules/agents-integration/cursor/index.ts";
import { recordAgentLimits } from "../../modules/usage-analytics/index.ts";
import { json, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/cursor/usage",
    handler: async ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      const value = await cursorUsage();
      recordAgentLimits("cursor", value);
      json(res, 200, value);
    },
  },
];
