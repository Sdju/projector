import { readFilesExclude, writeFilesExclude } from "../../../modules/workspace/index.ts";
import { json, readBody, type RouteDefinition } from "../../../modules/transport/index.ts";
import { accessAllowed } from "../../../modules/access/index.ts";
import { HttpError } from "../../../modules/http/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/ide/files-exclude",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Настройки доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, { exclude: await readFilesExclude() });
    },
  },
  {
    method: "PUT",
    path: "/api/ide/files-exclude",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, true))
        throw new HttpError(403, "Настройки доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req);
      json(res, 200, { exclude: await writeFilesExclude(body.exclude ?? body) });
    },
  },
  {
    method: "",
    path: "/api/ide/files-exclude",
    handler: ({ req, res }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Настройки доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(res, 405, { error: "Метод не поддерживается" });
    },
  },
];
