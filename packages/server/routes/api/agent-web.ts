import { configureWebSearch, webSearchSettings } from "../../modules/agents/projector/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { json, readBody } from "../../modules/transport/index.ts";
import type { RouteDefinition } from "../../modules/transport/index.ts";

/** Web search of the Projector agent: `GET` the chosen service, `PUT` changes it and the key. */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/agent/web",
    handler: async ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await webSearchSettings());
    },
  },
  {
    method: "PUT",
    path: "/api/agent/web",
    handler: async ({ req, res }) => {
      res.setHeader("Cache-Control", "no-store");
      try {
        json(res, 200, await configureWebSearch(await readBody(req)));
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
    },
  },
];
