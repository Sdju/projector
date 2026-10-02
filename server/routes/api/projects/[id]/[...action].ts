import { getSnapshot, startProject, stopProject } from "../../../../modules/processes/index.ts";
import { loadProjects, updateProjects } from "../../../../modules/projects/index.ts";

import { projectAppUrl } from "../../../../../core/modules/app-paths/index.ts";
import { resolveProjectIcon } from "../../../../modules/projects/index.ts";

import { HttpError } from "../../../../modules/http/index.ts";

import { openBrowser, openWindow } from "../../../../modules/window/index.ts";

import {
  closeProjectTerminals,
  uploadTerminalFile,
  renameTerminalSession,
  terminalSessionSnapshot,
  stopTerminalSession,
  closeTerminalSession,
  createTerminalSession,
  listTerminalSessions,
  terminalRequestAllowed,
  resolveTerminalFile,
} from "../../../../modules/terminal/index.ts";
import {
  listProjectDirectory,
  previewExternalFile,
  readExternalImage,
  previewProjectFile,
  searchProject,
  projectGit,
  projectComparison,
  mutateProjectGit,
  moveProjectEntry,
  mutateProjectEntry,
  saveProjectFile,
  readProjectImage,
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

    if (action === "workspace" && sessionId === "file" && method === "PUT") {
      if (!terminalRequestAllowed(req, true))
        throw new HttpError(403, "Сохранение доступно только со страницы Projector");
      const body = await readBody(req);
      if (
        typeof body.path !== "string" ||
        typeof body.content !== "string" ||
        typeof body.original !== "string"
      )
        throw new HttpError(400, "Укажите путь, текст и исходное содержимое файла");
      res.setHeader("Cache-Control", "no-store");
      json(
        res,
        200,
        await saveProjectFile(project.path, body.path, body.content, body.original),
      );
      return true;
    }

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

    if (action === "workspace" && sessionId === "entry" && method === "POST") {
      if (!terminalRequestAllowed(req, true))
        throw new HttpError(403, "Операции доступны только со страницы Projector");
      const body = await readBody(req);
      for (const key of ["action", "path", "directory", "name"])
        if (typeof body[key] !== "string")
          throw new HttpError(400, "Некорректные параметры операции");
      res.setHeader("Cache-Control", "no-store");
      json(
        res,
        200,
        await mutateProjectEntry(
          project.path,
          body.action as string,
          body.path as string,
          body.directory as string,
          body.name as string,
        ),
      );
      return true;
    }

    if (action === "workspace" && sessionId === "git" && method === "POST") {
      if (!terminalRequestAllowed(req, true))
        throw new HttpError(403, "Операции доступны только со страницы Projector");
      const body = await readBody(req);
      const paths = body.paths ?? body.path;
      if (typeof body.action !== "string" ||
        !(typeof paths === "string" || (Array.isArray(paths) && paths.every((path) => typeof path === "string"))))
        throw new HttpError(400, "Укажите действие Git и пути файлов");
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await mutateProjectGit(project.path, body.action, paths));
      return true;
    }

    if (action === "workspace" && method === "GET") {
      if (!terminalRequestAllowed(req, false))
        throw new HttpError(403, "Обзор доступен только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      const filePath = url.searchParams.get("path") ?? "";
      if (sessionId === "asset" || sessionId === "external-asset") {
        const image = sessionId === "external-asset"
          ? await readExternalImage(filePath)
          : await readProjectImage(project.path, filePath);
        res.setHeader("Content-Type", image.type);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader(
          "Content-Security-Policy",
          "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        );
        res.end(image.content);
        return true;
      }
      if (sessionId === "external") json(res, 200, await previewExternalFile(filePath));
      else if (sessionId === "root") json(res, 200, { root: project.path });
      else if (sessionId === "tree")
        json(res, 200, await listProjectDirectory(project.path, filePath));
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
      if (sessionId && method === "PUT") {
        if (!terminalRequestAllowed(req, true))
          throw new HttpError(403, "Загрузка доступна только со страницы Projector");
        json(res, 201, { path: await uploadTerminalFile(id, sessionId, req, url.searchParams.get("name") ?? "") });
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
          if (!terminalRequestAllowed(req, false)) throw new HttpError(403, "Открытие доступно только со страницы Projector");
          res.setHeader("Cache-Control", "no-store");
          json(res, 200, await resolveTerminalFile(project, sessionId, url.searchParams.get("link") ?? ""));
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
