import {
  envFallbackFromProcess,
  loadPublicProviders,
  saveProviders,
} from "../../modules/providers/index.ts";
import type { OpenAIProviderWrite } from "../../modules/providers/index.ts";

import { json, readBody, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/providers",
    handler: async ({ res }) => {
      json(res, 200, await loadPublicProviders(envFallbackFromProcess()));
    },
  },
  {
    method: "PUT",
    path: "/api/providers",
    handler: async ({ req, res }) => {
      const body = await readBody(req);
      const providers = Array.isArray(body.providers) ? body.providers : [];
      json(
        res,
        200,
        await saveProviders(
          {
            activeProviderId:
              typeof body.activeProviderId === "string" ? body.activeProviderId : null,
            providers: providers as OpenAIProviderWrite[],
          },
          envFallbackFromProcess(),
        ),
      );
    },
  },
];
