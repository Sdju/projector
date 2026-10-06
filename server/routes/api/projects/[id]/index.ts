import { mkdir, stat } from "node:fs/promises";
import { getSnapshot, startProject, stopProject } from "../../../../modules/processes/index.ts";
import {
  loadProjects,
  findProject,
  expandPath,
  updateProjects,
  resolveProjectIcon,
} from "../../../../modules/projects/index.ts";
import { projectAppUrl } from "../../../../../core/modules/app-paths/index.ts";
import { HttpError } from "../../../../modules/http/index.ts";
import { isLocalRequest } from "../../../../modules/access/index.ts";
import {
  devcontainerState,
  decideDevcontainer,
  stopDevcontainer,
} from "../../../../modules/devcontainer/index.ts";
import { openBrowser, openWindow } from "../../../../modules/window/index.ts";
import { closeProjectTerminals } from "../../../../modules/terminal/index.ts";
import { projectGithubRepository } from "../../../../modules/workspace/index.ts";
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

export async function handleProjectActions({
  req,
  res,
  method,
  path,
}: RouteContext): Promise<boolean> {
  const projectMatch = path.match(/^\/api\/projects\/([^/]+)(?:\/([^/]+))?$/);
  if (projectMatch) {
    const [, id, action] = projectMatch;
    const project = await findProject(id);
    if (!project) {
      json(res, 404, { error: "Проект не найден" });
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

    // Recovery of a project whose folder is gone: recreate it or point the project elsewhere.
    if (action === "directory" && method === "POST") {
      const body = await readBody(req);
      const isDirectory = (dir: string) =>
        stat(dir).then(
          (info) => info.isDirectory(),
          () => false,
        );
      const mode = asString(body.mode);
      if (mode !== "create" && mode !== "relocate")
        throw new HttpError(400, "mode: create или relocate");
      const target = expandPath(mode === "create" ? project.path : asString(body.path));
      if (mode === "relocate" && !asString(body.path).trim())
        throw new HttpError(400, "Укажите новый путь");
      if (mode === "relocate" && !(await isDirectory(target))) {
        if (body.create !== true) throw new HttpError(400, "Папка не найдена");
      }
      if (!(await isDirectory(target))) {
        const existing = await stat(target).catch(() => null);
        if (existing) throw new HttpError(400, "Путь занят файлом");
        await mkdir(target, { recursive: true });
      }
      if (mode === "relocate" && target !== expandPath(project.path)) {
        const duplicate = (await loadProjects()).find(
          (item) => item.id !== id && expandPath(item.path) === target,
        );
        if (duplicate) throw new HttpError(409, `Путь уже занят проектом «${duplicate.name}»`);
        stopProject(id);
        closeProjectTerminals(id);
        await updateProjects((current) => {
          const item = current.find((entry) => entry.id === id);
          if (!item) throw new HttpError(404, "Проект не найден");
          item.path = target;
        });
      }
      json(res, 200, { project: withRuntime({ ...project, path: target }) });
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

    if (action === "github" && method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, {
        repository: project.environment ? null : await projectGithubRepository(project.path),
      });
      return true;
    }

    if (action === "devcontainer" && method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, devcontainerState(project));
      return true;
    }

    if (action === "devcontainer" && method === "POST") {
      // Trust is granted at the keyboard of this machine: never over LAN, never by the agent.
      if (!isLocalRequest(req))
        throw new HttpError(403, "Доверие к репозиторию задаётся только на локальной машине");
      const body = await readBody(req);
      if (body.decision !== "trusted" && body.decision !== "declined" && body.decision !== "forget")
        throw new HttpError(400, "decision: trusted, declined или forget");
      json(res, 200, await decideDevcontainer(project, body.decision, body.hash));
      return true;
    }

    if (action === "devcontainer-stop" && method === "POST") {
      json(res, 200, await stopDevcontainer(project));
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
