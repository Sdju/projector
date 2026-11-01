import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { lensRequestFrom } from "../../modules/agent/index.ts";
import { runLens } from "../../modules/agents/projector/index.ts";
import { json, readBody } from "../../modules/transport/index.ts";
import type { RouteContext } from "../../modules/transport/index.ts";

/**
 * Lens: a short caption of the chat's current work, held by the request itself. Unlike `/api/agent`
 * it creates no run record and writes no history; it only reads what the page already shows.
 */
export async function handleAgentLens({ req, res, method, path }: RouteContext): Promise<boolean> {
  if (path !== "/api/agent/lens" || method !== "POST") return false;
  if (!accessAllowed(req, true))
    throw new HttpError(403, "Lens доступен только со страницы Projector");
  const body = await readBody(req);
  const request = lensRequestFrom(body);
  if (!request.history.length && !request.busy)
    throw new Error("Пока нечего показывать: в чате ещё нет работы");
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  const text = await runLens({ ...request, signal: abort.signal });
  json(res, 200, { text, at: Date.now() });
  return true;
}
