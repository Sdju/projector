import { mergeWorktree, removeWorktree, worktreeStatus } from "../../modules/agent/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { loadProjects } from "../../modules/projects/index.ts";
import { asString, json, readBody } from "../../modules/transport/index.ts";
import type { RouteContext } from "../../modules/transport/index.ts";

async function projectPath(projectId: string): Promise<string> {
  const project = (await loadProjects()).find((item) => item.id === projectId);
  if (!project) throw new Error("Проект не найден");
  return project.path;
}

/** The isolated copies of a project that agent chats work in: what changed, merge, discard. */
export async function handleAgentWorktrees({
  req,
  res,
  url,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (path === "/api/agent/worktree" && method === "GET") {
    const projectId = url.searchParams.get("projectId") ?? "";
    json(
      res,
      200,
      await worktreeStatus(
        projectId,
        url.searchParams.get("id") ?? "",
        await projectPath(projectId),
      ),
    );
    return true;
  }
  if (
    (path === "/api/agent/worktree/merge" || path === "/api/agent/worktree/discard") &&
    method === "POST"
  ) {
    if (!accessAllowed(req, true))
      throw new HttpError(403, "Доступно только со страницы Projector");
    const body = await readBody(req);
    const projectId = asString(body.projectId);
    const id = asString(body.id);
    const root = await projectPath(projectId);
    if (path.endsWith("/merge")) json(res, 200, await mergeWorktree(projectId, id, root));
    else {
      await removeWorktree(projectId, id, root);
      json(res, 200, { ok: true });
    }
    return true;
  }
  return false;
}
