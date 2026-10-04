import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { HttpServer } from "vite";
import { WebSocket, WebSocketServer } from "ws";
import { loadProjects } from "../projects/index.ts";
import { MAX_BUFFER, state, size, send, broadcast, flow, type Session } from "./session-state.ts";
import { accessAllowed, protectLanSockets } from "../access/index.ts";

export function attachTerminalServer(server: Server | HttpServer): void {
  if (state.servers.has(server)) return;
  state.servers.add(server);
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });
  const alive = new WeakSet<WebSocket>();
  protectLanSockets(server, sockets);
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
    clearInterval(heartbeat);
    for (const client of sockets.clients) client.terminate();
    sockets.close();
  });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (socket.writableEnded || socket.destroyed) return;
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    if (url.pathname !== "/api/terminal/socket") return; // Leave Vite HMR alone.
    if (!accessAllowed(req, true, url.searchParams.get("token") ?? undefined)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const session = state.sessions.get(url.searchParams.get("session") ?? "");
    if (!session) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    void loadProjects()
      .then((projects) => {
        if (
          !projects.some((project) => project.id === session.info.projectId) ||
          session.disposed
        ) {
          socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
          return;
        }
        sockets.handleUpgrade(req, socket, head, (client) => {
          sockets.emit("connection", client, req);
          alive.add(client);
          client.on("pong", () => alive.add(client));
          client.on("error", () => client.terminate());
          client.on("close", () => {
            session.clients.delete(client);
            session.pending.delete(client);
            flow(session);
          });
          screenSnapshot(session, client);
          client.on("message", (raw, binary) => {
            try {
              if (binary) throw new Error("Ожидается JSON");
              const message = JSON.parse(raw.toString());
              if (message.type === "input") {
                if (
                  session.info.status !== "running" ||
                  typeof message.data !== "string" ||
                  message.data.length > 32768 ||
                  (message.encoding !== undefined && message.encoding !== "binary") ||
                  (message.encoding === "binary" && /[^\x00-\xff]/.test(message.data))
                ) {
                  throw new Error("Ввод недоступен");
                }
                session.pty.write(
                  message.encoding === "binary"
                    ? Buffer.from(message.data, "latin1")
                    : message.data,
                );
              } else if (message.type === "ack") {
                if (
                  !Number.isInteger(message.length) ||
                  message.length < 1 ||
                  message.length > MAX_BUFFER
                )
                  throw new Error("Некорректное подтверждение вывода");
                session.pending.set(
                  client,
                  Math.max(0, (session.pending.get(client) ?? 0) - message.length),
                );
                flow(session);
              } else if (message.type === "resize") {
                const dimensions = size(message.cols, message.rows);
                // Wait for output queued before this resize to be parsed first.
                session.screen.write("", () => {
                  if (session.disposed) return;
                  session.screen.resize(dimensions.cols, dimensions.rows);
                  try {
                    if (session.info.status === "running")
                      session.pty.resize(dimensions.cols, dimensions.rows);
                  } catch {
                    return; /* The process may have just exited. */
                  }
                  Object.assign(session.info, dimensions);
                  broadcast(session, { type: "status", session: { ...session.info } });
                });
              } else throw new Error("Неизвестное сообщение");
            } catch (error) {
              send(client, {
                type: "error",
                message: error instanceof Error ? error.message : "Ошибка терминала",
              });
            }
          });
        });
      })
      .catch(() => socket.destroy());
  });
}

function screenSnapshot(session: Session, client: WebSocket): void {
  session.screen.write("", () => {
    if (session.disposed || client.readyState !== WebSocket.OPEN) return;
    send(client, {
      type: "snapshot",
      session: { ...session.info },
      data: session.serialize.serialize() + session.mouseEncoding.serialize(),
    });
    session.clients.add(client);
  });
}
