import { envFallbackFromProcess, setActiveProvider } from "../../../modules/providers/index.ts";

import {
  json,
  readBody,
  asString,
  type RouteDefinition,
} from "../../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "PATCH",
    path: "/api/providers/active",
    handler: async ({ req, res }) => {
      const body = await readBody(req);
      json(res, 200, await setActiveProvider(asString(body.id), envFallbackFromProcess()));
    },
  },
];
