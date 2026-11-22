import { HttpError } from "../../../modules/http/index.ts";
import {
  checkAppUpdate,
  dismissAppUpdate,
  readAppUpdate,
} from "../../../modules/app-update/index.ts";
import {
  asString,
  json,
  readBody,
  type RouteDefinition,
} from "../../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/app/update",
    handler: async ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await readAppUpdate());
    },
  },
  {
    method: "POST",
    path: "/api/app/update",
    handler: async ({ req, res }) => {
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req);
      const action = asString(body.action).trim();
      if (action === "check") json(res, 200, await checkAppUpdate());
      else if (action === "dismiss")
        json(res, 200, await dismissAppUpdate(asString(body.version).trim() || undefined));
      else throw new HttpError(400, "action: check или dismiss");
    },
  },
  {
    method: "",
    path: "/api/app/update",
    handler: ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      json(res, 405, { error: "Допустимы GET и POST" });
    },
  },
];
