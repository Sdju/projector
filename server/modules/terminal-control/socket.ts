import type { Server } from "node:http";
import type { HttpServer } from "vite";
import { WebSocket, WebSocketServer } from "ws";
import { protectLanSockets } from "../access/index.ts";
import { onTerminalSessionsChanged } from "../terminal/index.ts";
import { defaultTerminalControlHandlers, type TerminalControlHandlers } from "./handlers.ts";

const host = globalThis as typeof globalThis & {
  projectorTerminalControlServers?: WeakSet<Server | HttpServer>;
};
const servers = (host.projectorTerminalControlServers ??= new WeakSet());

export function attachTerminalControlServer(
  server: Server | HttpServer,
  handlers: TerminalControlHandlers = defaultTerminalControlHandlers,
): (() => void) | undefined {
  if (servers.has(server)) return;
  servers.add(server);
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });
  const projects = new Map<WebSocket, string>();
  const unprotect = protectLanSockets(server, sockets, handlers.allowed);
  const alive = new WeakSet<WebSocket>();
  const send = (client: WebSocket, message: unknown) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > 1024 * 1024) {
      client.terminate();
      return;
    }
    client.send(JSON.stringify(message));
  };
  // The runtime throws between generations (a failed reload or a config restart): an open socket
  // keeps its last snapshot instead of crashing the process with an unhandled throw.
  const snapshot = (client: WebSocket, projectId: string) => {
    try {
      send(client, { type: "sessions", sessions: handlers.sessions(projectId) });
    } catch {}
  };
  const dirty = new Set<string>();
  const unsubscribe = onTerminalSessionsChanged((projectId) => {
    if (dirty.has(projectId)) return;
    dirty.add(projectId);
    queueMicrotask(() => {
      dirty.delete(projectId);
      for (const [client, id] of projects) if (id === projectId) snapshot(client, id);
    });
  });
  const heartbeat = setInterval(() => {
    for (const client of sockets.clients) {
      if (!alive.has(client)) {
        client.terminate();
        continue;
      }
      alive.delete(client);
      client.ping();
    }
  }, 30000);
  heartbeat.unref();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    clearInterval(heartbeat);
    unprotect();
    servers.delete(server);
    server.off("close", dispose);
    server.off("upgrade", upgrade);
    for (const client of sockets.clients) client.terminate();
    sockets.close();
  };
  const upgrade: (
    req: import("node:http").IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ) => void = (req, socket, head) => {
    if (socket.writableEnded || socket.destroyed) return;
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    if (url.pathname !== "/api/terminal/control") return;
    if (!handlers.allowed(req, true, url.searchParams.get("token") ?? undefined)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const projectId = url.searchParams.get("project") ?? "";
    void handlers
      .project(projectId)
      .then((project) => {
        if (!project) {
          socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
          return;
        }
        sockets.handleUpgrade(req, socket, head, (client) => {
          sockets.emit("connection", client, req);
          projects.set(client, projectId);
          alive.add(client);
          client.on("pong", () => alive.add(client));
          client.on("error", () => client.terminate());
          client.on("close", () => projects.delete(client));
          snapshot(client, projectId);
          // Serialize mutations from this connection without retrying them after disconnect.
          let queue = Promise.resolve();
          let queued = 0;
          client.on("message", (raw, binary) => {
            if (++queued > 64) {
              client.terminate();
              return;
            }
            queue = queue.then(async () => {
              --queued;
              if (client.readyState !== WebSocket.OPEN) return;
              let requestId: unknown;
              try {
                if (binary) throw new Error("Ожидается JSON");
                const message = JSON.parse(raw.toString());
                requestId = message.id;
                if (
                  !Number.isSafeInteger(requestId) ||
                  !["GET", "POST", "DELETE"].includes(message.method) ||
                  (message.sessionId !== undefined && typeof message.sessionId !== "string") ||
                  (message.link !== undefined && typeof message.link !== "string") ||
                  (message.body !== undefined &&
                    (!message.body ||
                      typeof message.body !== "object" ||
                      Array.isArray(message.body)))
                )
                  throw new Error("Некорректный запрос терминала");
                const data = await handlers.control(
                  projectId,
                  message.method,
                  message.sessionId,
                  message.body,
                  message.link,
                );
                send(client, { type: "response", id: requestId, data });
              } catch (error) {
                send(client, {
                  type: "response",
                  id: requestId,
                  data: { error: error instanceof Error ? error.message : "Ошибка терминала" },
                });
              }
            });
          });
        });
      })
      .catch(() => socket.destroy());
  };
  server.on("upgrade", upgrade);
  server.once("close", dispose);
  return dispose;
}
