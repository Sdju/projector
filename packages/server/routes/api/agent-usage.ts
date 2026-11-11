import { readAgentUsageLimits } from "../../modules/agent-usage/index.ts";
import { recordAgentLimits } from "../../modules/usage-analytics/index.ts";
import { json, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/agent/usage/:id",
    handler: async ({ res, params }) => {
      const id = decodeURIComponent(params.id!);
      res.setHeader("Cache-Control", "no-store");
      const value = await readAgentUsageLimits(id);
      recordAgentLimits(id, value);
      json(res, 200, value);
    },
  },
  {
    method: "",
    path: "/api/agent/usage/:id",
    handler: ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      json(res, 405, { error: "Метод не поддерживается" });
    },
  },
];
