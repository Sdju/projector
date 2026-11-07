import { inspectProject, inspectProjectCommands } from "../../modules/projects/index.ts";

import { json, readBody, asString, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "POST",
    path: "/api/inspect/commands",
    handler: async ({ req, res }) => {
      const body = await readBody(req);
      json(res, 200, { commands: await inspectProjectCommands(asString(body.path)) });
    },
  },
  {
    method: "POST",
    path: "/api/inspect",
    handler: async ({ req, res }) => {
      const body = await readBody(req);
      const result = await inspectProject(asString(body.path));
      json(res, 200, result);
    },
  },
];
