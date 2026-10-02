import { randomUUID } from "node:crypto";

export interface CommandRequest {
  operation: "list" | "describe" | "execute";
  query?: string;
  command?: string;
  scope?: string;
  args?: unknown;
}
const pending = new Map<string, (result: { output?: unknown; error?: string }) => void>();

/** Each request has a single-use capability, delivered only to its originating SSE client. */
export function createCommandBridge(
  emit: (event: "command-request", data: unknown) => void,
  signal: AbortSignal,
  timeoutMs = 60000,
) {
  return (request: CommandRequest): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error("Запрос остановлен"));
      const id = randomUUID();
      const finish = (result: { output?: unknown; error?: string }) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        pending.delete(id);
        if (result.error) reject(new Error(result.error));
        else resolve(result.output);
      };
      const cancel = () => finish({ error: "Запрос остановлен" });
      const timer = setTimeout(
        () => finish({ error: "Projector не ответил на вызов команды" }),
        timeoutMs,
      );
      pending.set(id, finish);
      signal.addEventListener("abort", cancel, { once: true });
      emit("command-request", { id, ...request });
    });
}
export function completeCommandRequest(
  id: string,
  result: { output?: unknown; error?: string },
): boolean {
  const finish = pending.get(id);
  if (!finish) return false;
  finish(result);
  return true;
}
