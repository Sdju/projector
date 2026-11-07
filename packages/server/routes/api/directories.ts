import { listDirectories } from "../../modules/directories/index.ts";

import { HttpError } from "../../modules/http/index.ts";

import { accessAllowed } from "../../modules/access/index.ts";

import { json, type RouteDefinition } from "../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/directories",
    handler: async ({ req, res, url }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Папки доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(
        res,
        200,
        await listDirectories(
          url.searchParams.get("path") ?? "",
          url.searchParams.get("complete") === "true",
        ),
      );
    },
  },
];
