import { listProviderModels } from "../../../modules/providers/index.ts";
import {
  asString,
  json,
  readBody,
  type RouteDefinition,
} from "../../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "POST",
    path: "/api/providers/models",
    handler: async ({ req, res }) => {
      const body = await readBody(req);
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, {
        models: await listProviderModels({
          id: asString(body.id),
          url: asString(body.url),
          apiKey: asString(body.apiKey),
        }),
      });
    },
  },
];
