import { findProject } from "../../../../modules/projects/index.ts";
import { HttpError } from "../../../../modules/http/index.ts";
import {
  json,
  readBody,
  type RouteContext,
  type RouteDefinition,
} from "../../../../modules/transport/index.ts";
import { uploadTerminalFile } from "../../../../modules/terminal/index.ts";
import { terminalControl } from "../../../../modules/terminal-control/index.ts";
import { accessAllowed } from "../../../../modules/access/index.ts";

/** HTTP compatibility and binary upload; the browser controls sessions over WS. */
async function control({ req, res, url, method, params }: RouteContext, sessionId?: string) {
  const body = method === "GET" ? {} : await readBody(req);
  const result = await terminalControl(
    params.id,
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
}

export const routes: RouteDefinition[] = [
  {
    method: "PUT",
    path: "/api/projects/:id/terminals/:sessionId",
    handler: async ({ req, res, url, params }) => {
      if (!(await findProject(params.id))) throw new HttpError(404, "Проект не найден");
      if (!accessAllowed(req, true))
        throw new HttpError(403, "Загрузка доступна только со страницы Projector");
      json(res, 201, {
        path: await uploadTerminalFile(
          params.id,
          params.sessionId,
          req,
          url.searchParams.get("name") ?? "",
        ),
      });
    },
  },
  {
    method: ["GET", "POST", "DELETE"],
    path: "/api/projects/:id/terminals",
    handler: (context) => control(context),
  },
  {
    method: ["GET", "POST", "DELETE"],
    path: "/api/projects/:id/terminals/:sessionId",
    handler: (context) => control(context, context.params.sessionId),
  },
];
