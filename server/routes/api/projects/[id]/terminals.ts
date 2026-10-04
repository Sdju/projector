import { findProject } from "../../../../modules/projects/index.ts";
import { HttpError } from "../../../../modules/http/index.ts";
import { json, readBody } from "../../../../modules/transport/index.ts";
import { getSnapshot, startProject, stopProject } from "../../../../modules/processes/index.ts";
import {
  uploadTerminalFile,
  renameTerminalSession,
  terminalSessionSnapshot,
  stopTerminalSession,
  closeTerminalSession,
  createTerminalSession,
  listTerminalSessions,
  resolveTerminalFile,
} from "../../../../modules/terminal/index.ts";
import { accessAllowed } from "../../../../modules/access/index.ts";
import type { RouteContext } from "../../../../modules/transport/index.ts";

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
  const project = await findProject(id);
  if (!project) {
    json(res, 404, { error: "Проект не найден" });
    return true;
  }

  if (sessionId && method === "PUT") {
    if (!accessAllowed(req, true))
      throw new HttpError(403, "Загрузка доступна только со страницы Projector");
    json(res, 201, {
      path: await uploadTerminalFile(id, sessionId, req, url.searchParams.get("name") ?? ""),
    });
    return true;
  }
  if (!sessionId && method === "GET") {
    json(res, 200, { sessions: listTerminalSessions(id) });
    return true;
  }
  if (!sessionId && method === "POST") {
    json(res, 201, { session: createTerminalSession(project, await readBody(req)) });
    return true;
  }
  if (sessionId && method === "POST") {
    const previous = listTerminalSessions(id).find((item) => item.id === sessionId);
    if (!previous) throw new HttpError(404, "Терминал не найден");
    const body = await readBody(req);
    if (body.action === "rename") {
      if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 80)
        throw new HttpError(400, "Название должно содержать от 1 до 80 символов");
      json(res, 200, { session: renameTerminalSession(id, sessionId, body.title.trim()) });
    } else if (body.action === "stop") {
      const running = getSnapshot(id);
      if (previous.commandId && running.pid === previous.pid && running.status === "running")
        stopProject(id);
      else stopTerminalSession(id, sessionId);
      json(res, 200, {
        session: listTerminalSessions(id).find((item) => item.id === sessionId),
      });
    } else if (body.action === "restart") {
      if (previous.docker && previous.docker.kind !== "environment") throw new HttpError(409, "Повторите Docker-действие из панели Docker");
      if (previous.status !== "exited") throw new HttpError(409, "Сначала завершите сессию");
      let session;
      if (previous.commandId) {
        if (!project.commands.some((command) => command.id === previous.commandId))
          throw new HttpError(400, "Команда проекта больше не существует");
        const running = startProject(project, previous.commandId, "server", previous.id);
        session = listTerminalSessions(id).find((item) => item.pid === running.pid);
      } else {
        session = createTerminalSession(
          project,
          { program: previous.program },
          undefined,
          previous.id,
        );
      }
      json(res, 201, { session });
    } else throw new HttpError(400, "Неизвестное действие с сессией");
    return true;
  }
  if (sessionId && method === "GET") {
    if (url.searchParams.has("link")) {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Открытие доступно только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(
        res,
        200,
        await resolveTerminalFile(project, sessionId, url.searchParams.get("link") ?? ""),
      );
      return true;
    }
    const session = terminalSessionSnapshot(id, sessionId);
    if (!session) throw new HttpError(404, "Терминал не найден");
    res.setHeader("Cache-Control", "no-store");
    json(res, 200, { session });
    return true;
  }
  if (sessionId && method === "DELETE") {
    const body = await readBody(req);
    const session = terminalSessionSnapshot(id, sessionId);
    if (session) {
      if (
        session.activity?.state !== "idle" &&
        body.confirmation !== session.activity?.confirmation
      ) {
        json(res, 409, { error: "Подтвердите прерывание процессов", session });
        return true;
      }
    }
    closeTerminalSession(id, sessionId);
    json(res, 200, { ok: true });
    return true;
  }
  return false;
}
