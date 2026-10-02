import { getSnapshot, startProject, stopProject } from "../../../../modules/processes/index.ts";
import { loadProjects, updateProjects } from "../../../../modules/projects/index.ts";

import { projectAppUrl } from "../../../../../core/modules/app-paths/index.ts";
import { resolveProjectIcon } from "../../../../modules/projects/index.ts";

import { HttpError } from "../../../../modules/http/index.ts";

import { openBrowser, openWindow } from "../../../../modules/window/index.ts";

import {
  closeProjectTerminals,
  terminalSessionSnapshot,
  stopTerminalSession,
  closeTerminalSession,
  createTerminalSession,
  listTerminalSessions,
  terminalRequestAllowed,
} from "../../../../modules/terminal/index.ts";
import {
  listProjectDirectory,
  previewProjectFile,
  searchProject,
  projectGit,
  projectComparison,
  moveProjectEntry,
} from "../../../../modules/workspace/index.ts";
import { json, readBody, asString } from "../../../../modules/transport/index.ts";

import {
  parseMode,
  normalizeProject,
  withRuntime,
  sendIconFile,
  sendLetterIcon,
  launchHtml,
} from "../../../../modules/project-presentation/index.ts";
import type { RouteContext } from "../../../../modules/transport/index.ts";

export async function handleProjectsProjectActions({
  req,
  res,
  url,
  method,
  path,
}: RouteContext): Promise<boolean> {
  const projectMatch = path.match(/^\/api\/projects\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/);
  if (projectMatch) {
    const [, id, action, sessionId] = projectMatch;
    const projects = await loadProjects();
    const index = projects.findIndex((item) => item.id === id);
    if (index === -1) {
      json(res, 404, { error: "Проект не найден" });
      return true;
    }
    const project = projects[index];

    if (action === "workspace" && sessionId === "move" && method === "POST") {
      if (!terminalRequestAllowed(req, true))
        throw new HttpError(403, "Перенос доступен только со страницы Projector");
      const body = await readBody(req);
      if (typeof body.path !== "string" || typeof body.directory !== "string")
        throw new HttpError(400, "Укажите файл и папку назначения");
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await moveProjectEntry(project.path, body.path, body.directory));
      return true;
    }

    if (action === "workspace" && method === "GET") {
      if (!terminalRequestAllowed(req, false))
        throw new HttpError(403, "Обзор доступен только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      const filePath = url.searchParams.get("path") ?? "";
      if (sessionId === "tree") json(res, 200, await listProjectDirectory(project.path, filePath));
      else if (sessionId === "file")
        json(res, 200, await previewProjectFile(project.path, filePath));
      else if (sessionId === "search")
        json(res, 200, await searchProject(project.path, url.searchParams.get("q") ?? ""));
      else if (sessionId === "git") json(res, 200, await projectGit(project.path));
      else if (sessionId === "diff")
        json(
          res,
          200,
          await projectComparison(
            project.path,
            filePath,
            url.searchParams.get("staged") === "true",
          ),
        );
      else json(res, 404, { error: "Не найден" });
      return true;
    }

    if (action === "terminals") {
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
        if (body.action === "stop") {
          const running = getSnapshot(id);
          if (previous.commandId && running.pid === previous.pid && running.status === "running")
            stopProject(id);
          else stopTerminalSession(id, sessionId);
          json(res, 200, {
            session: listTerminalSessions(id).find((item) => item.id === sessionId),
          });
        } else if (body.action === "restart") {
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
    }
    if (sessionId) {
      json(res, 404, { error: "Не найден" });
      return true;
    }

    if (!action && method === "GET") {
      json(res, 200, { project: withRuntime(project) });
      return true;
    }

    if (!action && method === "PATCH") {
      const body = await readBody(req);
      const next = normalizeProject({ ...project, ...body }, project);
      await updateProjects((current) => {
        const currentIndex = current.findIndex((item) => item.id === id);
        if (currentIndex === -1) throw new HttpError(404, "Проект не найден");
        current[currentIndex] = next;
      });
      json(res, 200, { project: withRuntime(next) });
      return true;
    }

    if (!action && method === "DELETE") {
      stopProject(id);
      closeProjectTerminals(id);
      await updateProjects((current) => {
        const currentIndex = current.findIndex((item) => item.id === id);
        if (currentIndex !== -1) current.splice(currentIndex, 1);
      });
      json(res, 200, { ok: true });
      return true;
    }

    if (action === "start" && method === "POST") {
      const body = await readBody(req);
      const runtime = startProject(
        project,
        asString(body.commandId) || undefined,
        parseMode(body.mode),
      );
      json(res, 200, { runtime });
      return true;
    }

    if (action === "stop" && method === "POST") {
      json(res, 200, { runtime: stopProject(id) });
      return true;
    }

    if (action === "open" && method === "POST") {
      const body = await readBody(req);
      const runtime = getSnapshot(id);
      const target = runtime.url || project.url;
      if (!target) throw new Error("Нет адреса для открытия");
      if (parseMode(body.mode) === "window") openWindow(projectAppUrl(id));
      else openBrowser(target);
      json(res, 200, { ok: true, url: target });
      return true;
    }

    if (action === "icon" && method === "GET") {
      const file = await resolveProjectIcon(project.path, project.icon);
      if (file) sendIconFile(res, file);
      else sendLetterIcon(res, project.name);
      return true;
    }

    if (action === "app" && method === "GET") {
      const runtime = getSnapshot(id);
      const target = runtime.url || project.url;
      if (!target) throw new Error("Нет адреса для открытия");
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(launchHtml(project, target));
      return true;
    }
  }
  return false;
}
