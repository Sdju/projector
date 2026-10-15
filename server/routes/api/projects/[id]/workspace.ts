import { findProject } from "../../../../modules/projects/index.ts";
import { HttpError } from "../../../../modules/http/index.ts";
import { json, readBody } from "../../../../modules/transport/index.ts";
import { accessAllowed, isLocalRequest } from "../../../../modules/access/index.ts";
import {
  listProjectDirectory,
  previewExternalFile,
  readExternalImage,
  previewProjectFile,
  searchProject,
  findProjectPaths,
  projectGit,
  projectComparison,
  projectGutter,
  projectLog,
  projectBranches,
  mutateProjectBranch,
  projectCommit,
  projectCommitComparison,
  mutateProjectGit,
  moveProjectEntry,
  mutateProjectEntry,
  saveProjectFile,
  checkImportNames,
  clearImportNames,
  importProjectEntries,
  uploadProjectEntry,
  readProjectImage,
  watchProject,
} from "../../../../modules/workspace/index.ts";
import type { RouteContext } from "../../../../modules/transport/index.ts";

export async function handleProjectWorkspace({
  req,
  res,
  url,
  method,
  path,
}: RouteContext): Promise<boolean> {
  const match = path.match(/^\/api\/projects\/([^/]+)\/workspace\/([^/]+)$/);
  if (!match) return false;
  const [, id, sessionId] = match;
  const project = await findProject(id);
  if (!project) {
    json(res, 404, { error: "Проект не найден" });
    return true;
  }

  if (sessionId === "file" && method === "PUT") {
    if (!accessAllowed(req, true))
      throw new HttpError(403, "Сохранение доступно только со страницы Projector");
    const body = await readBody(req);
    if (
      typeof body.path !== "string" ||
      typeof body.content !== "string" ||
      typeof body.original !== "string"
    )
      throw new HttpError(400, "Укажите путь, текст и исходное содержимое файла");
    res.setHeader("Cache-Control", "no-store");
    json(res, 200, await saveProjectFile(project.path, body.path, body.content, body.original));
    return true;
  }

  if (sessionId === "watch" && method === "PUT") {
    if (!accessAllowed(req, false))
      throw new HttpError(403, "Обзор доступен только со страницы Projector");
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
    return true;
  }

  if (sessionId === "import" && method === "POST") {
    if (!accessAllowed(req, true))
      throw new HttpError(403, "Импорт доступен только со страницы Projector");
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
      return true;
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
      return true;
    }
    throw new HttpError(400, "Неизвестное действие импорта");
  }

  if (sessionId === "upload" && method === "PUT") {
    if (!accessAllowed(req, true))
      throw new HttpError(403, "Загрузка доступна только со страницы Projector");
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
    return true;
  }

  if (sessionId === "move" && method === "POST") {
    if (!accessAllowed(req, true))
      throw new HttpError(403, "Перенос доступен только со страницы Projector");
    const body = await readBody(req);
    if (typeof body.path !== "string" || typeof body.directory !== "string")
      throw new HttpError(400, "Укажите файл и папку назначения");
    res.setHeader("Cache-Control", "no-store");
    json(res, 200, await moveProjectEntry(project.path, body.path, body.directory));
    return true;
  }

  if (sessionId === "entry" && method === "POST") {
    if (!accessAllowed(req, true))
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

  if (sessionId === "branch" && method === "POST") {
    if (!accessAllowed(req, true))
      throw new HttpError(403, "Операции доступны только со страницы Projector");
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
    return true;
  }

  if (sessionId === "git" && method === "POST") {
    if (!accessAllowed(req, true))
      throw new HttpError(403, "Операции доступны только со страницы Projector");
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
    return true;
  }

  if (method === "GET") {
    if (!accessAllowed(req, false))
      throw new HttpError(403, "Обзор доступен только со страницы Projector");
    res.setHeader("Cache-Control", "no-store");
    const filePath = url.searchParams.get("path") ?? "";
    if (sessionId === "asset" || sessionId === "external-asset") {
      const image =
        sessionId === "external-asset"
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
    const ask = url.searchParams.get("ask") === "1";
    if (sessionId === "external") json(res, 200, await previewExternalFile(filePath, { ask }));
    else if (sessionId === "root") json(res, 200, { root: project.path });
    else if (sessionId === "tree")
      json(
        res,
        200,
        await listProjectDirectory(project.path, filePath, Object.fromEntries(url.searchParams)),
      );
    else if (sessionId === "file")
      json(res, 200, await previewProjectFile(project.path, filePath, { ask }));
    else if (sessionId === "search")
      json(
        res,
        200,
        await searchProject(project.path, url.searchParams.get("q") ?? "", {
          caseSensitive: url.searchParams.get("case") === "true",
          wholeWord: url.searchParams.get("word") === "true",
          regex: url.searchParams.get("regex") === "true",
        }),
      );
    else if (sessionId === "paths")
      json(res, 200, {
        paths: await findProjectPaths(project.path, url.searchParams.get("q") ?? ""),
      });
    else if (sessionId === "git") json(res, 200, await projectGit(project.path));
    else if (sessionId === "branches") json(res, 200, await projectBranches(project.path));
    else if (sessionId === "log")
      json(
        res,
        200,
        await projectLog(project.path, {
          skip: Number(url.searchParams.get("skip")) || 0,
          limit: Number(url.searchParams.get("limit")) || undefined,
          query: url.searchParams.get("q") ?? "",
          all: url.searchParams.get("all") === "true",
        }),
      );
    else if (sessionId === "commit")
      json(res, 200, await projectCommit(project.path, url.searchParams.get("hash") ?? ""));
    else if (sessionId === "commit-diff")
      json(
        res,
        200,
        await projectCommitComparison(project.path, url.searchParams.get("hash") ?? "", filePath),
      );
    else if (sessionId === "gutter") json(res, 200, await projectGutter(project.path, filePath));
    else if (sessionId === "diff")
      json(
        res,
        200,
        await projectComparison(project.path, filePath, url.searchParams.get("staged") === "true"),
      );
    else json(res, 404, { error: "Не найден" });
    return true;
  }

  return false;
}
