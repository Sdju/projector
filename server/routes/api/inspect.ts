import { inspectProject } from "../../modules/projects/index.ts";

import { json, readBody, asString } from "../../modules/transport/index.ts";

import type { RouteContext } from "../../modules/transport/index.ts";

export async function handleInspect({ req, res, method, path }: RouteContext): Promise<boolean> {
  if (path === "/api/inspect" && method === "POST") {
    const body = await readBody(req);
    const result = await inspectProject(asString(body.path));
    json(res, 200, result);
    return true;
  }
  return false;
}
