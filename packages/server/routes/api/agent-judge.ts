import { readJudgeSettings, writeJudgeSettings } from "../../modules/judge/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { json, readBody } from "../../modules/transport/index.ts";
import type { RouteDefinition } from "../../modules/transport/index.ts";

/** Global Projector Judge settings; a chat may override them in its own history. */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/agent/judge",
    handler: async ({ req, res }) => {
      // A same-origin GET carries no Origin header; a change still has to come from the page.
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Судья доступен только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await readJudgeSettings());
    },
  },
  {
    method: "PUT",
    path: "/api/agent/judge",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, true))
        throw new HttpError(403, "Судья доступен только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      try {
        json(res, 200, await writeJudgeSettings(await readBody(req)));
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Неверные настройки");
      }
    },
  },
];
