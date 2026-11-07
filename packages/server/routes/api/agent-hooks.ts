import { listHooks, readUserHooks, writeUserHooks } from "../../modules/agents/projector/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { asString, json, readBody } from "../../modules/transport/index.ts";
import type { RouteDefinition } from "../../modules/transport/index.ts";

/** Hooks of the Projector agent: `GET` the user's file and what applies to the project, `PUT` saves the file. */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/agent/hooks",
    handler: async ({ res, url }) => {
      res.setHeader("Cache-Control", "no-store");
      const cwd = url.searchParams.get("path") || undefined;
      const hooks = (await listHooks(cwd)).map((item) => ({
        event: item.event,
        source: item.source,
        command: item.command,
        matcher: item.matcher?.source,
      }));
      json(res, 200, { text: await readUserHooks(), hooks });
    },
  },
  {
    method: "PUT",
    path: "/api/agent/hooks",
    handler: async ({ req, res }) => {
      res.setHeader("Cache-Control", "no-store");
      try {
        await writeUserHooks(asString((await readBody(req)).text));
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
      json(res, 200, { ok: true });
    },
  },
];
