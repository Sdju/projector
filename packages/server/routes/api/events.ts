import { attachSse, updateEventPages } from "../../modules/events/index.ts";
import { json, readBody, type RouteDefinition } from "../../modules/transport/index.ts";

const ids = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && !!id && id.length <= 100)
    : [];

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/events",
    handler: ({ req, res }) => {
      attachSse(req, res);
    },
  },
  {
    method: "POST",
    path: "/api/events/pages",
    handler: async ({ req, res }) => {
      const body = await readBody(req);
      const stream = typeof body.stream === "string" ? body.stream : "";
      json(res, 200, {
        ok: stream !== "" && updateEventPages(stream, ids(body.add), ids(body.remove)),
      });
    },
  },
];
