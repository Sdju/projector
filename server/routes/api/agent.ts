import { runInstallerAgent } from "../../modules/agent/index.ts";

import type { AgentHistoryTurn } from "../../modules/providers/index.ts";

import { readBody, asString } from "../../modules/transport/index.ts";

import type { RouteContext } from "../../modules/transport/index.ts";

export async function handleAgent({ req, res, method, path }: RouteContext): Promise<boolean> {
  if (path === "/api/agent" && method === "POST") {
    const body = await readBody(req);
    const message = asString(body.message);
    if (!message) throw new Error("Напишите, какой проект добавить");
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
    req.on("close", () => abort.abort());
    const emit = (event: string, data: unknown) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      await runInstallerAgent({
        message,
        history,
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
