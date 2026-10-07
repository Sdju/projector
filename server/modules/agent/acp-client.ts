import type { ChildProcessWithoutNullStreams } from "node:child_process";

/** A spawned agent process; `terminate` is supplied by the OS adapter to stop the whole tree. */
type AcpProcess = ChildProcessWithoutNullStreams & { terminate?(): Promise<void> };

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export interface AcpConnectionHandlers {
  /** Notifications from the agent that need no response (`session/update`, ...). */
  onNotification(method: string, params: Record<string, unknown>): void;
  /** Requests from the agent that must be answered (`session/request_permission`, ...). */
  onRequest(method: string, params: Record<string, unknown>): unknown | Promise<unknown>;
  /** Program name for error messages; defaults to "Агент". */
  label?: string;
}

/** `fatal` marks a dead connection: retrying another request on it cannot succeed. */
export type AcpError = Error & { code?: number; fatal?: boolean };

/** Handshake requests (`initialize`, `session/new`, `authenticate`) get a short idle timeout. */
export const HANDSHAKE_TIMEOUT_MS = 120_000;
/** A turn waits for the agent and for user approvals, so it is bounded by abort, not by a timer. */
export const NO_TIMEOUT = 0;

export type AcpConnection = ReturnType<typeof createAcpConnection>;

/** How much of the child's stderr to keep for the failure message. */
const STDERR_LIMIT = 4000;

/**
 * The client half of the Agent Client Protocol: JSON-RPC 2.0 over newline-delimited JSON on a
 * child process's stdio. One connection lives for a single chat turn and is then closed.
 * The request timeout (per request, `NO_TIMEOUT` to disable) is idle-based: every incoming message postpones it, so a streaming turn or
 * a pending permission prompt is not cut off while the agent is still working.
 */
export function createAcpConnection(child: AcpProcess, handlers: AcpConnectionHandlers) {
  const label = handlers.label ?? "Агент";
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  let closed = false;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; arm: () => void }
  >();

  const fail = (error: Error) => {
    if (closed) return;
    closed = true;
    (error as AcpError).fatal = true;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  const write = (message: RpcMessage) => {
    if (!closed) child.stdin.write(JSON.stringify(message) + "\n");
  };
  const respond = (id: RpcMessage["id"], result: unknown) => write({ jsonrpc: "2.0", id, result });
  const respondError = (id: RpcMessage["id"], code: number, message: string) =>
    write({ jsonrpc: "2.0", id, error: { code, message } });
  /** Any traffic means the agent is alive: postpone every pending request's idle timeout. */
  const touch = () => {
    for (const waiter of pending.values()) waiter.arm();
  };

  async function dispatch(message: RpcMessage): Promise<void> {
    touch();
    if (message.method && message.id !== undefined) {
      try {
        const result = await handlers.onRequest(
          message.method,
          (message.params ?? {}) as Record<string, unknown>,
        );
        respond(message.id, result ?? {});
      } catch (error) {
        respondError(message.id, -32000, error instanceof Error ? error.message : "Ошибка клиента");
      }
      return;
    }
    if (message.method) {
      handlers.onNotification(message.method, (message.params ?? {}) as Record<string, unknown>);
      return;
    }
    if (message.id === undefined) return;
    const waiter = pending.get(Number(message.id));
    if (!waiter) return;
    pending.delete(Number(message.id));
    if (message.error) {
      const error = new Error(message.error.message || "Ошибка агента") as AcpError;
      error.code = message.error.code;
      waiter.reject(error);
    } else waiter.resolve(message.result);
  }

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      let message: RpcMessage;
      try {
        message = JSON.parse(line) as RpcMessage;
      } catch {
        continue;
      }
      void dispatch(message);
    }
  });
  // Drain stderr so a chatty agent cannot block on a full pipe, and keep the tail for errors.
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_LIMIT);
  });
  child.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") fail(new Error(`${label} не найден в PATH`));
    else fail(new Error(`${label} недоступен: ${error.message}`));
  });
  child.on("close", () => {
    const tail = stderr.trim();
    fail(
      new Error(tail ? `${label} завершился до ответа: ${tail}` : `${label} завершился до ответа`),
    );
  });
  child.stdin.on("error", () => fail(new Error(`Соединение с ${label} закрыто`)));

  function request(
    method: string,
    params: unknown,
    timeoutMs = HANDSHAKE_TIMEOUT_MS,
  ): Promise<unknown> {
    if (closed) return Promise.reject(new Error(`${label} уже завершился`));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const arm = () => {
        clearTimeout(timer);
        if (timeoutMs > 0)
          timer = setTimeout(() => {
            pending.delete(id);
            const error: AcpError = new Error(`${label} не ответил вовремя`);
            error.fatal = true;
            reject(error);
          }, timeoutMs);
      };
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        arm,
      });
      arm();
      write({ jsonrpc: "2.0", id, method, params });
    });
  }

  return {
    request,
    notify: (method: string, params: unknown) => write({ jsonrpc: "2.0", method, params }),
    respond,
    respondError,
    /** Stops the whole agent tree (when the OS adapter provides it) and waits for exit. */
    async close() {
      fail(new Error("Соединение закрыто"));
      child.stdin.end();
      if (child.terminate) await child.terminate();
      else child.kill();
    },
  };
}
