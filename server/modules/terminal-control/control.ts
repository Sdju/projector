import { findProject } from "../projects/index.ts";
import { HttpError } from "../http/index.ts";
import { getSnapshot, startProject, stopProject } from "../processes/index.ts";
import {
  createTerminalSession,
  listTerminalSessions,
  renameTerminalSession,
  stopTerminalSession,
  terminalSessionSnapshot,
  closeTerminalSession,
  resolveTerminalFile,
} from "../terminal/index.ts";

export async function terminalControl(
  projectId: string,
  method: string,
  sessionId?: string,
  body: Record<string, unknown> = {},
  link?: string,
): Promise<Record<string, unknown>> {
  const project = await findProject(projectId);
  if (!project) throw new HttpError(404, "Проект не найден");
  const id = projectId;
  if (!sessionId && method === "GET") {
    return { sessions: listTerminalSessions(id) };
  }
  if (!sessionId && method === "POST") {
    return { session: createTerminalSession(project, body) };
  }
  if (sessionId && method === "POST") {
    const previous = listTerminalSessions(id).find((item) => item.id === sessionId);
    if (!previous) throw new HttpError(404, "Терминал не найден");
    if (body.action === "rename") {
      if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 80)
        throw new HttpError(400, "Название должно содержать от 1 до 80 символов");
      return { session: renameTerminalSession(id, sessionId, body.title.trim()) };
    } else if (body.action === "stop") {
      const running = getSnapshot(id);
      if (previous.commandId && running.pid === previous.pid && running.status === "running")
        stopProject(id);
      else stopTerminalSession(id, sessionId);
      return { session: listTerminalSessions(id).find((item) => item.id === sessionId) };
    } else if (body.action === "restart") {
      if (previous.docker && previous.docker.kind !== "environment")
        throw new HttpError(409, "Повторите Docker-действие из панели Docker");
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
      return { session };
    } else throw new HttpError(400, "Неизвестное действие с сессией");
  }
  if (sessionId && method === "GET") {
    if (link !== undefined) return await resolveTerminalFile(project, sessionId, link);
    const session = terminalSessionSnapshot(id, sessionId);
    if (!session) throw new HttpError(404, "Терминал не найден");
    return { session };
  }
  if (sessionId && method === "DELETE") {
    const session = terminalSessionSnapshot(id, sessionId);
    if (
      session &&
      session.activity?.state !== "idle" &&
      body.confirmation !== session.activity?.confirmation
    )
      return { error: "Подтвердите прерывание процессов", session };
    closeTerminalSession(id, sessionId!);
    return { ok: true };
  }
  throw new HttpError(400, "Неизвестное действие с сессией");
}
