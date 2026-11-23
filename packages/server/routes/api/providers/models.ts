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
      const list = await listProviderModels({
        id: asString(body.id),
        url: asString(body.url),
        kind: asString(body.kind),
        apiKey: asString(body.apiKey),
      });
      json(res, 200, { models: list.models, details: list.details });
    },
  },
];
