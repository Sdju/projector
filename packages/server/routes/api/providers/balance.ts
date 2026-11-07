import { providerBalance } from "../../../modules/providers/index.ts";
import { json, type RouteDefinition } from "../../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/providers/balance",
    handler: async ({ res, url }) => {
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await providerBalance(url.searchParams.get("id")?.trim() || undefined));
    },
  },
];
