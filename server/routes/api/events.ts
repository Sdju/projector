import { attachSse } from "../../modules/events/index.ts";

import type { RouteContext } from "../../modules/transport/index.ts";

export async function handleEvents({ req, res, method, path }: RouteContext): Promise<boolean> {
  if (path === "/api/events" && method === "GET") {
    attachSse(req, res);
    return true;
  }
  return false;
}
