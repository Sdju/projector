import { findProject } from "../../../../modules/projects/index.ts";
import { HttpError } from "../../../../modules/http/index.ts";
import {
  json,
  readBody,
  type RouteContext,
  type RouteDefinition,
} from "../../../../modules/transport/index.ts";
import { accessAllowed, isLocalRequest } from "../../../../modules/access/index.ts";
import {
  mutateProjectBranch,
  mutateProjectGit,
  mutateProjectSync,
  moveProjectEntry,
  mutateProjectEntry,
  saveProjectFile,
  checkImportNames,
  clearImportNames,
  importProjectEntries,
  uploadProjectEntry,
  revealProjectEntry,
  watchProject,
} from "../../../../modules/workspace/index.ts";

type Project = NonNullable<Awaited<ReturnType<typeof findProject>>>;

async function requireProject({ res, params }: Pick<RouteContext, "res" | "params">) {
  const project = await findProject(params.id);
  if (!project) json(res, 404, { error: "Проект не найден" });
  return project;
}

type Handler = (context: RouteContext, project: Project) => void | Promise<void>;

function route(
  method: string,
  path: string,
  access: boolean,
  message: string,
  handler: Handler,
): RouteDefinition {
  return {
    method,
    path,
    handler: async (context) => {
      const project = await requireProject(context);
      if (!project) return;
      if (!accessAllowed(context.req, access)) throw new HttpError(403, message);
      await handler(context, project);
    },
  };
}

const mutation = (method: "POST" | "PUT", path: string, message: string, handler: Handler) =>
  route(method, path, true, message, handler);

export const routes: RouteDefinition[] = [
  mutation(
    "PUT",
    "/api/projects/:id/workspace/file",
    "Сохранение доступно только со страницы Projector",
    async ({ req, res }, project) => {
      const body = await readBody(req);
      if (
        typeof body.path !== "string" ||
        typeof body.content !== "string" ||
        typeof body.original !== "string"
      )
        throw new HttpError(400, "Укажите путь, текст и исходное содержимое файла");
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await saveProjectFile(project.path, body.path, body.content, body.original));
    },
  ),
  route(
    "PUT",
    "/api/projects/:id/workspace/watch",
    false,
    "Обзор доступен только со страницы Projector",
    async ({ req, res }, project) => {
      const body = await readBody(req);
      const list = (value: unknown) =>
        value === undefined ||
        (Array.isArray(value) && value.every((item) => typeof item === "string"));
      if (
        typeof body.client !== "string" ||
        !body.client ||
        !list(body.paths) ||
        !list(body.directories)
      )
        throw new HttpError(400, "Укажите страницу, пути открытых файлов и раскрытые папки");
      await watchProject(body.client, project.id, project.path, {
        paths: body.paths as string[] | undefined,
        directories: body.directories as string[] | undefined,
      });
      json(res, 200, { ok: true });
    },
  ),
  mutation(
    "POST",
    "/api/projects/:id/workspace/reveal",
    "Показ в проводнике доступен только со страницы Projector",
    async ({ req, res }, project) => {
      if (!isLocalRequest(req))
        throw new HttpError(403, "Показ в проводнике доступен только на этом компьютере");
      const body = await readBody(req);
      if (typeof body.path !== "string") throw new HttpError(400, "Укажите путь");
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await revealProjectEntry(project.path, body.path));
    },
  ),
  mutation(
    "POST",
    "/api/projects/:id/workspace/import",
    "Импорт доступен только со страницы Projector",
    async ({ req, res }, project) => {
      const body = await readBody(req);
      const names = (value: unknown) =>
        Array.isArray(value) && value.every((item) => typeof item === "string")
          ? (value as string[])
          : undefined;
      if (typeof body.directory !== "string") throw new HttpError(400, "Укажите папку назначения");
      res.setHeader("Cache-Control", "no-store");
      if (body.action === "check" || body.action === "clear") {
        const list = names(body.names);
        if (!list) throw new HttpError(400, "Укажите имена записей");
        json(
          res,
          200,
          body.action === "check"
            ? await checkImportNames(project.path, body.directory, list)
            : (await clearImportNames(project.path, body.directory, list), { ok: true }),
        );
        return;
      }
      if (body.action === "copy") {
        // Пути диска имеют смысл только на машине сервера: удалённая страница загружает файлы.
        if (!isLocalRequest(req))
          throw new HttpError(403, "Копирование по пути доступно только на этом компьютере");
        const entries = body.entries;
        if (
          !Array.isArray(entries) ||
          !entries.every(
            (entry) => entry && typeof entry.source === "string" && typeof entry.name === "string",
          )
        )
          throw new HttpError(400, "Укажите пути и имена записей");
        json(res, 200, await importProjectEntries(project.path, body.directory, entries));
        return;
      }
      throw new HttpError(400, "Неизвестное действие импорта");
    },
  ),
  mutation(
    "PUT",
    "/api/projects/:id/workspace/upload",
    "Загрузка доступна только со страницы Projector",
    async ({ req, res, url }, project) => {
      const directory = url.searchParams.get("directory") ?? "";
      const entry = url.searchParams.get("path") ?? "";
      res.setHeader("Cache-Control", "no-store");
      json(
        res,
        200,
        await uploadProjectEntry(project.path, directory, entry, req, {
          directory: url.searchParams.get("kind") === "directory",
        }),
      );
    },
  ),
  mutation(
    "POST",
    "/api/projects/:id/workspace/move",
    "Перенос доступен только со страницы Projector",
    async ({ req, res }, project) => {
      const body = await readBody(req);
      if (typeof body.path !== "string" || typeof body.directory !== "string")
        throw new HttpError(400, "Укажите файл и папку назначения");
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await moveProjectEntry(project.path, body.path, body.directory));
    },
  ),
  mutation(
    "POST",
    "/api/projects/:id/workspace/entry",
    "Операции доступны только со страницы Projector",
    async ({ req, res }, project) => {
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
    },
  ),
  mutation(
    "POST",
    "/api/projects/:id/workspace/branch",
    "Операции доступны только со страницы Projector",
    async ({ req, res }, project) => {
      const body = await readBody(req);
      for (const key of ["name", "newName", "from"])
        if (body[key] !== undefined && typeof body[key] !== "string")
          throw new HttpError(400, "Некорректные параметры ветки");
      if (typeof body.action !== "string") throw new HttpError(400, "Укажите действие с веткой");
      res.setHeader("Cache-Control", "no-store");
      json(
        res,
        200,
        await mutateProjectBranch(project.path, body.action, {
          name: body.name as string | undefined,
          newName: body.newName as string | undefined,
          from: body.from as string | undefined,
          checkout: body.checkout === false ? false : undefined,
          force: body.force === true,
        }),
      );
    },
  ),
  mutation(
    "POST",
    "/api/projects/:id/workspace/sync",
    "Операции доступны только со страницы Projector",
    async ({ req, res }, project) => {
      const body = await readBody(req);
      if (typeof body.action !== "string")
        throw new HttpError(400, "Укажите действие синхронизации");
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await mutateProjectSync(project.path, body.action));
    },
  ),
  mutation(
    "POST",
    "/api/projects/:id/workspace/git",
    "Операции доступны только со страницы Projector",
    async ({ req, res }, project) => {
      const body = await readBody(req);
      const paths = body.paths ?? body.path;
      if (
        typeof body.action !== "string" ||
        !(
          typeof paths === "string" ||
          (Array.isArray(paths) && paths.every((path) => typeof path === "string"))
        )
      )
        throw new HttpError(400, "Укажите действие Git и пути файлов");
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await mutateProjectGit(project.path, body.action, paths));
    },
  ),
];
