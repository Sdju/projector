import { accessAllowed } from "../../../modules/access/index.ts";
import { HttpError } from "../../../modules/http/index.ts";
import {
  claimIdeCommand,
  completeIdeCommand,
  ideMcpTokenMatches,
  requestIdeCommand,
} from "../../../modules/ide/index.ts";
import type { AgentCommandCall } from "../../../../core/modules/ide/index.ts";
import { asString, json, readBody, type RouteContext } from "../../../modules/transport/index.ts";

function commandCall(value: unknown): AgentCommandCall {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "Некорректный запрос команды");
  const body = value as Record<string, unknown>;
  const operation = asString(body.operation);
  if (!["list", "describe", "execute"].includes(operation))
    throw new HttpError(400, "operation: list, describe или execute");
  return {
    operation: operation as AgentCommandCall["operation"],
    ...(typeof body.query === "string" ? { query: body.query.slice(0, 400) } : {}),
    ...(typeof body.command === "string" ? { command: body.command.slice(0, 200) } : {}),
    ...(typeof body.scope === "string" ? { scope: body.scope.slice(0, 200) } : {}),
    ...(body.args === undefined ? {} : { args: body.args }),
  };
}

/**
 * The bridge of the built-in IDE MCP server: an external agent's tool call arrives here with the
 * server's key, the open page claims it and returns the result of the live command registry.
 */
export async function handleIdeCommands({ req, res, method, path }: RouteContext) {
  if (path === "/api/ide/command-request" || path.startsWith("/api/ide/command-request/"))
    res.setHeader("Cache-Control", "no-store");
  if (path === "/api/ide/command-request" && method === "POST") {
    if (!accessAllowed(req, false)) throw new HttpError(403, "Доступ запрещён");
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (!(await ideMcpTokenMatches(token))) throw new HttpError(403, "Неверный ключ MCP");
    const body = await readBody(req);
    const projectId = asString(body.projectId);
    if (!projectId) throw new HttpError(400, "Укажите projectId");
    const session = asString(body.session) || projectId;
    json(res, 200, {
      output: await requestIdeCommand(projectId, session, commandCall(body.request)),
    });
    return true;
  }
  if (path === "/api/ide/command-request/claim" && method === "POST") {
    if (!accessAllowed(req, true)) throw new HttpError(403, "Доступно только странице Projector");
    const body = await readBody(req);
    json(res, 200, { claimed: claimIdeCommand(asString(body.id), asString(body.page)) });
    return true;
  }
  if (path === "/api/ide/command-request/result" && method === "POST") {
    if (!accessAllowed(req, true)) throw new HttpError(403, "Доступно только странице Projector");
    const body = await readBody(req);
    const accepted = completeIdeCommand(asString(body.id), asString(body.page), {
      output: body.output,
      error: asString(body.error) || undefined,
    });
    json(res, accepted ? 200 : 410, { accepted });
    return true;
  }
  return false;
}
