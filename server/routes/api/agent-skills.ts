import { listSkills, skillFolders } from "../../modules/agents/projector/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { loadProjects } from "../../modules/projects/index.ts";
import { json, type RouteContext } from "../../modules/transport/index.ts";

/** Skills and prompt commands of the Projector agent: the user's, plus the project's when `projectId` is given. */
export async function handleAgentSkills({ res, url, method, path }: RouteContext) {
  if (path !== "/api/agent/skills" || method !== "GET") return false;
  res.setHeader("Cache-Control", "no-store");
  const projectId = url.searchParams.get("projectId") ?? "";
  const project = projectId
    ? (await loadProjects()).find((item) => item.id === projectId)
    : undefined;
  if (projectId && !project) throw new HttpError(404, "Проект не найден");
  const skills = await listSkills(project?.path);
  json(res, 200, {
    skills: skills.map(({ name, description, hint, source, kind }) => ({
      name,
      description,
      hint,
      source,
      kind,
    })),
    folders: skillFolders(project?.path),
  });
  return true;
}
