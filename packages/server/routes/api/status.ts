import { listSnapshots } from "../../modules/processes/index.ts";

import { json, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/status",
    handler: ({ res }) => {
      json(res, 200, { processes: listSnapshots() });
    },
  },
];
