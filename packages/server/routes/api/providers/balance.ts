import { providerBalance } from "../../../modules/providers/index.ts";
import { recordProviderBalance } from "../../../modules/usage-analytics/index.ts";
import { json, type RouteDefinition } from "../../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/providers/balance",
    handler: async ({ res, url }) => {
      res.setHeader("Cache-Control", "no-store");
      const value = await providerBalance(url.searchParams.get("id")?.trim() || undefined);
      recordProviderBalance(value);
      json(res, 200, value);
    },
  },
];
