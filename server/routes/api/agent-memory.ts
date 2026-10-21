import { projectMemories, readMemory, writeMemory } from "../../modules/agents/projector/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { asString, json, readBody, type RouteContext } from "../../modules/transport/index.ts";

/** Notes of the Projector agent: `GET` lists them, `PUT` replaces the notes of one scope. */
export async function handleAgentMemory({ req, res, method, path }: RouteContext) {
  if (path !== "/api/agent/memory") return false;
  res.setHeader("Cache-Control", "no-store");
  if (method === "GET") {
    json(res, 200, { user: await readMemory("user"), projects: await projectMemories() });
    return true;
  }
  if (method === "PUT") {
    const body = await readBody(req);
    const scope = body.scope === "project" ? "project" : "user";
    const project = asString(body.path);
    if (scope === "project" && !project) throw new HttpError(400, "Укажите проект");
    try {
      const text = await writeMemory(scope, project || undefined, asString(body.text));
      json(res, 200, { text });
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    return true;
  }
  return false;
}
