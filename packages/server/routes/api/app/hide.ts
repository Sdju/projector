import { hidePalette } from "../../../modules/window/index.ts";

import { json, type RouteDefinition } from "../../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "POST",
    path: "/api/app/hide",
    handler: async ({ res }) => {
      await hidePalette();
      json(res, 200, { ok: true });
    },
  },
];
