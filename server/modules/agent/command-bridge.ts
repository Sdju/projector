import { randomUUID } from "node:crypto";

export interface CommandRequest {
  operation: "list" | "describe" | "execute";
  query?: string;
  command?: string;
  scope?: string;
  args?: unknown;
}

/** A backend asks the user before running a tool it considers sensitive. */
export interface ApprovalRequest {
  tool: string;
  input: unknown;
  /** Backend-provided one-line label, e.g. "Edit src/main.ts". */
  title?: string;
}

type BridgeResult = { output?: unknown; error?: string };
const pending = new Map<string, (result: BridgeResult) => void>();

/** Each request has a single-use capability, delivered only to its originating SSE client. */
function bridgeRequest(
  send: (data: unknown) => void,
  payload: object,
  signal: AbortSignal,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Запрос остановлен"));
    const id = randomUUID();
    const finish = (result: BridgeResult) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      pending.delete(id);
      if (result.error) reject(new Error(result.error));
      else resolve(result.output);
    };
    const cancel = () => finish({ error: "Запрос остановлен" });
    const timer = setTimeout(() => finish({ error: timeoutMessage }), timeoutMs);
    pending.set(id, finish);
    signal.addEventListener("abort", cancel, { once: true });
    send({ id, ...payload });
  });
}

export function createCommandBridge(
  emit: (event: "command-request", data: unknown) => void,
  signal: AbortSignal,
  timeoutMs = 60000,
) {
  return (request: CommandRequest): Promise<unknown> =>
    bridgeRequest(
      (data) => emit("command-request", data),
      request,
      signal,
      timeoutMs,
      "Projector не ответил на вызов команды",
    );
}

/** Resolves `true` only when the user explicitly allows; a denial, timeout or abort rejects or yields `false`. */
export function createApprovalBridge(
  emit: (event: "permission-request", data: unknown) => void,
  signal: AbortSignal,
  timeoutMs = 10 * 60_000,
) {
  return async (request: ApprovalRequest): Promise<boolean> => {
    const output = await bridgeRequest(
      (data) => emit("permission-request", data),
      request,
      signal,
      timeoutMs,
      "Разрешение не получено вовремя",
    );
    return (output as { allow?: unknown } | undefined)?.allow === true;
  };
}

export function completeCommandRequest(id: string, result: BridgeResult): boolean {
  const finish = pending.get(id);
  if (!finish) return false;
  finish(result);
  return true;
}
