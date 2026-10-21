import { configureWebSearch, webSearchSettings } from "../../modules/agents/projector/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { json, readBody, type RouteContext } from "../../modules/transport/index.ts";

/** Web search of the Projector agent: `GET` the chosen service, `PUT` changes it and the key. */
export async function handleAgentWeb({ req, res, method, path }: RouteContext) {
  if (path !== "/api/agent/web") return false;
  res.setHeader("Cache-Control", "no-store");
  if (method === "GET") {
    json(res, 200, await webSearchSettings());
    return true;
  }
  if (method === "PUT") {
    try {
      json(res, 200, await configureWebSearch(await readBody(req)));
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    return true;
  }
  return false;
}
