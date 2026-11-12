import { findProject } from "../../../../modules/projects/index.ts";
import { HttpError } from "../../../../modules/http/index.ts";
import {
  json,
  type RouteContext,
  type RouteDefinition,
} from "../../../../modules/transport/index.ts";
import { accessAllowed } from "../../../../modules/access/index.ts";
import {
  listProjectDirectory,
  previewExternalFile,
  readExternalImage,
  previewProjectFile,
  searchProject,
  searchProjectGit,
  findProjectPaths,
  projectGit,
  projectComparison,
  projectGutter,
  projectLog,
  projectBranches,
  projectCommit,
  projectCommitComparison,
  listProjectGitTree,
  readProjectGitFile,
  readProjectGitImage,
  compareProjectChanges,
  compareProjectFile,
  readProjectImage,
} from "../../../../modules/workspace/index.ts";

type Project = NonNullable<Awaited<ReturnType<typeof findProject>>>;

async function requireProject({ res, params }: Pick<RouteContext, "res" | "params">) {
  const project = await findProject(params.id);
  if (!project) json(res, 404, { error: "Проект не найден" });
  return project;
}

const text = (url: URL, key: string) => url.searchParams.get(key) ?? "";

const params = (url: URL) => Object.fromEntries(url.searchParams);

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

const view = (path: string, handler: Handler) =>
  route(
    "GET",
    path,
    false,
    "Обзор доступен только со страницы Projector",
    async (context, project) => {
      context.res.setHeader("Cache-Control", "no-store");
      await handler(context, project);
    },
  );

async function sendAsset(context: RouteContext, project: Project, external: boolean) {
  const filePath = context.url.searchParams.get("path") ?? "";
  const rev = context.url.searchParams.get("rev") ?? "";
  const image = external
    ? await readExternalImage(filePath)
    : rev
      ? await readProjectGitImage(project.path, rev, filePath)
      : await readProjectImage(project.path, filePath);
  context.res.setHeader("Content-Type", image.type);
  context.res.setHeader("X-Content-Type-Options", "nosniff");
  context.res.setHeader(
    "Content-Security-Policy",
    "sandbox; default-src 'none'; style-src 'unsafe-inline'",
  );
  context.res.end(image.content);
}

export const routes: RouteDefinition[] = [
  view("/api/projects/:id/workspace/asset", (context, project) =>
    sendAsset(context, project, false),
  ),
  view("/api/projects/:id/workspace/external-asset", (context, project) =>
    sendAsset(context, project, true),
  ),
  view("/api/projects/:id/workspace/external", async ({ res, url }) => {
    json(res, 200, await previewExternalFile(text(url, "path"), { ask: text(url, "ask") === "1" }));
  }),
  view("/api/projects/:id/workspace/root", ({ res }, project) => {
    json(res, 200, { root: project.path });
  }),
  view("/api/projects/:id/workspace/tree", async ({ res, url }, project) => {
    const path = text(url, "path");
    json(
      res,
      200,
      text(url, "rev")
        ? await listProjectGitTree(project.path, text(url, "rev"), path, params(url))
        : await listProjectDirectory(project.path, path, params(url)),
    );
  }),
  view("/api/projects/:id/workspace/file", async ({ res, url }, project) => {
    const path = text(url, "path");
    const rev = text(url, "rev");
    const ask = text(url, "ask") === "1";
    json(
      res,
      200,
      rev
        ? await readProjectGitFile(project.path, rev, path, { ask })
        : await previewProjectFile(project.path, path, { ask }),
    );
  }),
  view("/api/projects/:id/workspace/changes", async ({ res, url }, project) => {
    const from = text(url, "from");
    const to = text(url, "to");
    if (!from || !to) throw new HttpError(400, "Укажите оба снимка для сравнения");
    json(res, 200, await compareProjectChanges(project.path, from, to));
  }),
  view("/api/projects/:id/workspace/compare-file", async ({ res, url }, project) => {
    const path = text(url, "path");
    const from = text(url, "from");
    const to = text(url, "to");
    if (!from || !to) throw new HttpError(400, "Укажите оба снимка для сравнения");
    json(
      res,
      200,
      await compareProjectFile(
        project.path,
        from,
        to,
        path,
        url.searchParams.get("originalPath") || path,
      ),
    );
  }),
  view("/api/projects/:id/workspace/search", async ({ res, url }, project) => {
    const rev = text(url, "rev");
    const options = {
      caseSensitive: text(url, "case") === "true",
      wholeWord: text(url, "word") === "true",
      regex: text(url, "regex") === "true",
    };
    json(
      res,
      200,
      rev
        ? await searchProjectGit(project.path, rev, text(url, "q"), options)
        : await searchProject(project.path, text(url, "q"), options),
    );
  }),
  view("/api/projects/:id/workspace/paths", async ({ res, url }, project) => {
    const limit = Number.parseInt(text(url, "limit"), 10);
    json(res, 200, {
      paths: await findProjectPaths(
        project.path,
        text(url, "q"),
        Number.isInteger(limit) ? limit : 30,
        text(url, "rev") || undefined,
      ),
    });
  }),
  view("/api/projects/:id/workspace/git", async ({ res }, project) => {
    json(res, 200, await projectGit(project.path));
  }),
  view("/api/projects/:id/workspace/branches", async ({ res }, project) => {
    json(res, 200, await projectBranches(project.path));
  }),
  view("/api/projects/:id/workspace/log", async ({ res, url }, project) => {
    json(
      res,
      200,
      await projectLog(project.path, {
        skip: Number(text(url, "skip")) || 0,
        limit: Number(text(url, "limit")) || undefined,
        query: text(url, "q"),
        all: text(url, "all") === "true",
      }),
    );
  }),
  view("/api/projects/:id/workspace/commit", async ({ res, url }, project) => {
    json(res, 200, await projectCommit(project.path, text(url, "hash")));
  }),
  view("/api/projects/:id/workspace/commit-diff", async ({ res, url }, project) => {
    json(
      res,
      200,
      await projectCommitComparison(project.path, text(url, "hash"), text(url, "path")),
    );
  }),
  view("/api/projects/:id/workspace/gutter", async ({ res, url }, project) => {
    json(res, 200, await projectGutter(project.path, text(url, "path")));
  }),
  view("/api/projects/:id/workspace/diff", async ({ res, url }, project) => {
    json(
      res,
      200,
      await projectComparison(project.path, text(url, "path"), text(url, "staged") === "true"),
    );
  }),
  view("/api/projects/:id/workspace/:session", ({ res }) => {
    json(res, 404, { error: "Не найден" });
  }),
];
