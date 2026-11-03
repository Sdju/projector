import { readJudgeSettings, writeJudgeSettings } from "../../modules/judge/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { json, readBody, type RouteContext } from "../../modules/transport/index.ts";

/** Global Projector Judge settings; a chat may override them in its own history. */
export async function handleAgentJudge({ req, res, method, path }: RouteContext) {
  if (path !== "/api/agent/judge") return false;
  // A same-origin GET carries no Origin header; a change still has to come from the page.
  if (!accessAllowed(req, method !== "GET"))
    throw new HttpError(403, "Судья доступен только со страницы Projector");
  res.setHeader("Cache-Control", "no-store");
  if (method === "GET") {
    json(res, 200, await readJudgeSettings());
    return true;
  }
  if (method === "PUT") {
    try {
      json(res, 200, await writeJudgeSettings(await readBody(req)));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Неверные настройки");
    }
    return true;
  }
  return false;
}
