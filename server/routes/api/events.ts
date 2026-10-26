import { attachSse, updateEventPages } from "../../modules/events/index.ts";
import { json, readBody } from "../../modules/transport/index.ts";

import type { RouteContext } from "../../modules/transport/index.ts";

const ids = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && !!id && id.length <= 100)
    : [];

export async function handleEvents({ req, res, method, path }: RouteContext): Promise<boolean> {
  if (path === "/api/events" && method === "GET") {
    attachSse(req, res);
    return true;
  }
  if (path === "/api/events/pages" && method === "POST") {
    const body = await readBody(req);
    const stream = typeof body.stream === "string" ? body.stream : "";
    json(res, 200, {
      ok: stream !== "" && updateEventPages(stream, ids(body.add), ids(body.remove)),
    });
    return true;
  }
  return false;
}
