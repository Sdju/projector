import { appUrl } from "@ai-projector/core/modules/app-paths/index.ts";

import { HttpError } from "../../../modules/http/index.ts";
import { restartProjector } from "../../../modules/restart/index.ts";

import { isLocalRequest } from "../../../modules/access/index.ts";

import { json, type RouteDefinition } from "../../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "POST",
    path: "/api/app/restart",
    handler: async ({ req, res }) => {
      if (!isLocalRequest(req))
        throw new HttpError(403, "Перезапуск доступен только с локальной машины");
      await restartProjector(appUrl());
      json(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 100).unref();
    },
  },
];
