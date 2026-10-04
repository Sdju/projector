import type { Server } from "node:http";
import type { HttpServer } from "vite";
import { WebSocket, WebSocketServer } from "ws";
import { accessAllowed } from "../access/index.ts";
import { findProject } from "../projects/index.ts";
import { listTerminalSessions, onTerminalSessionsChanged } from "../terminal/index.ts";
import { terminalControl } from "./control.ts";

const host = globalThis as typeof globalThis & {
  projectorTerminalControlServers?: WeakSet<Server | HttpServer>;
};
const servers = (host.projectorTerminalControlServers ??= new WeakSet());

export function attachTerminalControlServer(server: Server | HttpServer): void {
  if (servers.has(server)) return;
  servers.add(server);
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });
  const projects = new Map<WebSocket, string>();
  const alive = new WeakSet<WebSocket>();
  const send = (client: WebSocket, message: unknown) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > 1024 * 1024) {
      client.terminate();
      return;
    }
    client.send(JSON.stringify(message));
  };
  const snapshot = (client: WebSocket, projectId: string) =>
    send(client, { type: "sessions", sessions: listTerminalSessions(projectId) });
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
  server.once("close", () => {
    unsubscribe();
    clearInterval(heartbeat);
    for (const client of sockets.clients) client.terminate();
    sockets.close();
  });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/terminal/control") return;
    if (!accessAllowed(req, true, url.searchParams.get("token") ?? undefined)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const projectId = url.searchParams.get("project") ?? "";
    void findProject(projectId)
      .then((project) => {
        if (!project) {
          socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
          return;
        }
        sockets.handleUpgrade(req, socket, head, (client) => {
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
                const data = await terminalControl(
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
  });
}
