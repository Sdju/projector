import { accessAllowed } from "../../modules/access/index.ts";
import { createCommandBridge, runAgent, sideRequestFrom } from "../../modules/agent/index.ts";
import { loadProjects } from "../../modules/projects/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { readBody } from "../../modules/transport/index.ts";
import type { RouteContext } from "../../modules/transport/index.ts";

/**
 * A side question: a read-only answer about the current chat, held by the request itself. Unlike
 * `/api/agent` it creates no run record, writes no history and cannot be rejoined after a reload.
 */
export async function handleAgentSide({ req, res, method, path }: RouteContext): Promise<boolean> {
  if (path !== "/api/agent/side" || method !== "POST") return false;
  if (!accessAllowed(req, true))
    throw new HttpError(403, "Вопрос в сторону доступен только со страницы Projector");
  const body = await readBody(req);
  const request = sideRequestFrom(body);
  if (!request.projectId) throw new Error("Вопрос в сторону доступен в чате проекта");
  const project = (await loadProjects()).find((item) => item.id === request.projectId);
  if (!project) throw new Error("Проект не найден");

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  let finished = false;
  const abort = new AbortController();
  const emit = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  res.on("close", () => {
    if (!finished) abort.abort();
  });
  emit("meta", { mode: "projector", chat: request.chat, readOnly: true });
  try {
    await runAgent({
      backend: "projector",
      side: true,
      chat: request.chat || undefined,
      scope: `editor:${project.id}`,
      projectId: project.id,
      cwd: project.path,
      message: request.message,
      history: request.history,
      selection: request.selection,
      providerId: request.providerId,
      commands: createCommandBridge(emit, abort.signal),
      abort: abort.signal,
      emit,
    });
  } catch (error) {
    if (!abort.signal.aborted)
      emit("error", {
        error: error instanceof Error ? error.message : "Вопрос в сторону не удался",
      });
  } finally {
    finished = true;
    if (!res.writableEnded) res.end();
  }
  return true;
}
