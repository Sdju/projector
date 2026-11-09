import { openCodeUsage } from "../../modules/agents-integration/opencode/index.ts";
import { recordAgentLimits } from "../../modules/usage-analytics/index.ts";
import { json, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/opencode/usage",
    handler: async ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      const value = await openCodeUsage();
      recordAgentLimits("opencode", value);
      json(res, 200, value);
    },
  },
];
