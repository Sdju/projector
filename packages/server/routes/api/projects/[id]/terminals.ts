import { findProject } from "../../../../modules/projects/index.ts";
import { HttpError } from "../../../../modules/http/index.ts";
import { json, readBody } from "../../../../modules/transport/index.ts";
import { uploadTerminalFile } from "../../../../modules/terminal/index.ts";
import { terminalControl } from "../../../../modules/terminal-control/index.ts";
import { accessAllowed } from "../../../../modules/access/index.ts";
import type { RouteContext } from "../../../../modules/transport/index.ts";

/** HTTP compatibility and binary upload; the browser controls sessions over WS. */
export async function handleProjectTerminals({
  req,
  res,
  url,
  method,
  path,
}: RouteContext): Promise<boolean> {
  const match = path.match(/^\/api\/projects\/([^/]+)\/terminals(?:\/([^/]+))?$/);
  if (!match) return false;
  const [, id, sessionId] = match;
  if (sessionId && method === "PUT") {
    if (!(await findProject(id))) throw new HttpError(404, "Проект не найден");
    if (!accessAllowed(req, true))
      throw new HttpError(403, "Загрузка доступна только со страницы Projector");
    json(res, 201, {
      path: await uploadTerminalFile(id, sessionId, req, url.searchParams.get("name") ?? ""),
    });
    return true;
  }
  if (!["GET", "POST", "DELETE"].includes(method)) return false;
  const body = method === "GET" ? {} : await readBody(req);
  const result = await terminalControl(
    id,
    method,
    sessionId,
    body,
    url.searchParams.get("link") ?? undefined,
  );
  res.setHeader("Cache-Control", "no-store");
  json(
    res,
    result.error ? 409 : method === "POST" && (!sessionId || body.action === "restart") ? 201 : 200,
    result,
  );
  return true;
}
