import { mkdir, stat } from "node:fs/promises";
import { getSnapshot, startProject, stopProject } from "../../../../modules/processes/index.ts";
import {
  loadProjects,
  findProject,
  expandPath,
  sameLocalPath,
  updateProjects,
  resolveProjectIcon,
} from "../../../../modules/projects/index.ts";
import { projectAppUrl } from "@projector-ai/core/modules/app-paths/index.ts";
import { HttpError } from "../../../../modules/http/index.ts";
import { isLocalRequest } from "../../../../modules/access/index.ts";
import {
  devcontainerState,
  decideDevcontainer,
  stopDevcontainer,
} from "../../../../modules/devcontainer/index.ts";
import { openBrowser, openWindow } from "../../../../modules/window/index.ts";
import { closeProjectTerminals } from "../../../../modules/terminal/index.ts";
import {
  projectGithubRepository,
  projectGitlabRepository,
} from "../../../../modules/workspace/index.ts";
import {
  json,
  readBody,
  asString,
  type RouteContext,
  type RouteDefinition,
} from "../../../../modules/transport/index.ts";
import {
  parseMode,
  normalizeProject,
  withRuntime,
  sendIconFile,
  sendLetterIcon,
  launchHtml,
} from "../../../../modules/project-presentation/index.ts";

async function requireProject({ res, params }: Pick<RouteContext, "res" | "params">) {
  const project = await findProject(params.id);
  if (!project) json(res, 404, { error: "Проект не найден" });
  return project;
}

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/projects/:id",
    handler: async (context) => {
      const project = await requireProject(context);
      if (project) json(context.res, 200, { project: withRuntime(project) });
    },
  },
  {
    method: "PATCH",
    path: "/api/projects/:id",
    handler: async ({ req, res, params }) => {
      const project = await requireProject({ res, params });
      if (!project) return;
      const body = await readBody(req);
      const next = normalizeProject({ ...project, ...body }, project);
      await updateProjects((current) => {
        const currentIndex = current.findIndex((item) => item.id === params.id);
        if (currentIndex === -1) throw new HttpError(404, "Проект не найден");
        current[currentIndex] = next;
      });
      json(res, 200, { project: withRuntime(next) });
    },
  },
  {
    method: "DELETE",
    path: "/api/projects/:id",
    handler: async (context) => {
      const project = await requireProject(context);
      if (!project) return;
      stopProject(context.params.id);
      closeProjectTerminals(context.params.id);
      await updateProjects((current) => {
        const currentIndex = current.findIndex((item) => item.id === context.params.id);
        if (currentIndex !== -1) current.splice(currentIndex, 1);
      });
      json(context.res, 200, { ok: true });
    },
  },
  {
    // Recovery of a project whose folder is gone: recreate it or point the project elsewhere.
    method: "POST",
    path: "/api/projects/:id/directory",
    handler: async ({ req, res, params }) => {
      const project = await requireProject({ res, params });
      if (!project) return;
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
      if (mode === "relocate" && !sameLocalPath(project.path, target)) {
        const duplicate = (await loadProjects()).find(
          (item) => item.id !== params.id && sameLocalPath(item.path, target),
        );
        if (duplicate) throw new HttpError(409, `Путь уже занят проектом «${duplicate.name}»`);
        stopProject(params.id);
        closeProjectTerminals(params.id);
        await updateProjects((current) => {
          const item = current.find((entry) => entry.id === params.id);
          if (!item) throw new HttpError(404, "Проект не найден");
          item.path = target;
        });
      }
      json(res, 200, { project: withRuntime({ ...project, path: target }) });
    },
  },
  {
    method: "POST",
    path: "/api/projects/:id/start",
    handler: async (context) => {
      const project = await requireProject(context);
      if (!project) return;
      const body = await readBody(context.req);
      const runtime = startProject(
        project,
        asString(body.commandId) || undefined,
        parseMode(body.mode),
      );
      json(context.res, 200, { runtime });
    },
  },
  {
    method: "POST",
    path: "/api/projects/:id/stop",
    handler: async (context) => {
      if (!(await requireProject(context))) return;
      json(context.res, 200, { runtime: stopProject(context.params.id) });
    },
  },
  {
    method: "POST",
    path: "/api/projects/:id/open",
    handler: async (context) => {
      const project = await requireProject(context);
      if (!project) return;
      const body = await readBody(context.req);
      const runtime = getSnapshot(context.params.id);
      const target = runtime.url || project.url;
      if (!target) throw new Error("Нет адреса для открытия");
      if (parseMode(body.mode) === "window") openWindow(projectAppUrl(context.params.id));
      else openBrowser(target);
      json(context.res, 200, { ok: true, url: target });
    },
  },
  {
    method: "GET",
    path: "/api/projects/:id/github",
    handler: async (context) => {
      const project = await requireProject(context);
      if (!project) return;
      context.res.setHeader("Cache-Control", "no-store");
      json(context.res, 200, {
        repository: project.environment ? null : await projectGithubRepository(project.path),
      });
    },
  },
  {
    method: "GET",
    path: "/api/projects/:id/gitlab",
    handler: async (context) => {
      const project = await requireProject(context);
      if (!project) return;
      context.res.setHeader("Cache-Control", "no-store");
      json(context.res, 200, {
        repository: project.environment ? null : await projectGitlabRepository(project.path),
      });
    },
  },
  {
    method: "GET",
    path: "/api/projects/:id/devcontainer",
    handler: async (context) => {
      const project = await requireProject(context);
      if (!project) return;
      context.res.setHeader("Cache-Control", "no-store");
      json(context.res, 200, devcontainerState(project));
    },
  },
  {
    method: "POST",
    path: "/api/projects/:id/devcontainer",
    handler: async (context) => {
      const project = await requireProject(context);
      if (!project) return;
      // Trust is granted at the keyboard of this machine: never over LAN, never by the agent.
      if (!isLocalRequest(context.req))
        throw new HttpError(403, "Доверие к репозиторию задаётся только на локальной машине");
      const body = await readBody(context.req);
      if (body.decision !== "trusted" && body.decision !== "declined" && body.decision !== "forget")
        throw new HttpError(400, "decision: trusted, declined или forget");
      json(context.res, 200, await decideDevcontainer(project, body.decision, body.hash));
    },
  },
  {
    method: "POST",
    path: "/api/projects/:id/devcontainer-stop",
    handler: async (context) => {
      const project = await requireProject(context);
      if (!project) return;
      json(context.res, 200, await stopDevcontainer(project));
    },
  },
  {
    method: "GET",
    path: "/api/projects/:id/icon",
    handler: async (context) => {
      const project = await requireProject(context);
      if (!project) return;
      const file = await resolveProjectIcon(project.path, project.icon);
      if (file) sendIconFile(context.res, file);
      else sendLetterIcon(context.res, project.name);
    },
  },
  {
    method: "GET",
    path: "/api/projects/:id/app",
    handler: async (context) => {
      const project = await requireProject(context);
      if (!project) return;
      const runtime = getSnapshot(context.params.id);
      const target = runtime.url || project.url;
      if (!target) throw new Error("Нет адреса для открытия");
      context.res.statusCode = 200;
      context.res.setHeader("Content-Type", "text/html; charset=utf-8");
      context.res.setHeader("Cache-Control", "no-store");
      context.res.end(launchHtml(project, target));
    },
  },
];
