import { pickFolder } from "../../modules/folder-picker/index.ts";

import { json, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "POST",
    path: "/api/pick-folder",
    handler: async ({ res }) => {
      const picked = await pickFolder();
      json(res, 200, { path: picked, cancelled: !picked });
    },
  },
];
