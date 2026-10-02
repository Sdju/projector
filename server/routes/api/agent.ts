import { loadProjects } from "../../modules/projects/index.ts";
import {
  runInstallerAgent,
  createCommandBridge,
  completeCommandRequest,
  readAgentHistory,
  writeAgentHistory,
} from "../../modules/agent/index.ts";

import type { AgentHistoryTurn } from "../../modules/providers/index.ts";

import { readBody, asString, json } from "../../modules/transport/index.ts";

import type { RouteContext } from "../../modules/transport/index.ts";

export async function handleAgent({ req, res, method, path }: RouteContext): Promise<boolean> {
  const historyMatch = path.match(/^\/api\/agent\/history\/([^/]+)$/);
  if (historyMatch && (method === "GET" || method === "PUT")) {
    const id = decodeURIComponent(historyMatch[1]!);
    const turns =
      method === "GET"
        ? await readAgentHistory(id)
        : await writeAgentHistory(id, (await readBody(req)).turns);
    json(res, 200, { turns });
    return true;
  }
  if (path === "/api/agent/tool-result" && method === "POST") {
    const body = await readBody(req);
    const accepted = completeCommandRequest(asString(body.id), {
      output: body.output,
      error: asString(body.error) || undefined,
    });
    json(res, accepted ? 200 : 410, { accepted });
    return true;
  }
  if (path === "/api/agent" && method === "POST") {
    const body = await readBody(req);
    const message = asString(body.message);
    if (!message) throw new Error("Напишите сообщение агенту");
    const projectId = asString(body.projectId);
    const project = projectId
      ? (await loadProjects()).find((item) => item.id === projectId)
      : undefined;
    if (projectId && !project) throw new Error("Проект не найден");
    const history = Array.isArray(body.history)
      ? body.history.flatMap((item): AgentHistoryTurn[] => {
          if (!item || typeof item !== "object") return [];
          const row = item as Record<string, unknown>;
          const role = row.role === "assistant" ? "assistant" : row.role === "user" ? "user" : null;
          const content = asString(row.content);
          if (!role || !content) return [];
          return [{ role, content }];
        })
      : [];

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const emit = (event: string, data: unknown) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      await runInstallerAgent({
        message,
        history,
        cwd: project?.path,
        commands: body.commandBridge === true ? createCommandBridge(emit, abort.signal) : undefined,
        providerId: asString(body.providerId) || undefined,
        abort: abort.signal,
        emit,
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка агента";
      emit("error", { error: text });
    }
    if (!res.writableEnded) res.end();
    return true;
  }
  return false;
}
