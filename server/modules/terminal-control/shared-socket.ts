import type { Server } from "node:http";
import type { HttpServer } from "vite";
import { EventEmitter } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { accessAllowed, protectLanSockets } from "../access/index.ts";
import { findProject } from "../projects/index.ts";
import {
  listTerminalSessions,
  onTerminalSessionsChanged,
  subscribeTerminalPeer,
  type TerminalPeer,
} from "../terminal/index.ts";
import { terminalControl } from "./control.ts";

/** Each browser consumer has independent ACK accounting, even on a shared physical socket. */
class Channel extends EventEmitter implements TerminalPeer {
  readyState: number = WebSocket.OPEN;
  bufferedAmount = 0;
  queue: string[] = [];
  readonly projectId: string;
  readonly deliver: (data: string) => void;
  readonly ended: (code: number) => void;
  constructor(projectId: string, deliver: (data: string) => void, ended: (code: number) => void) {
    super();
    this.projectId = projectId;
    this.deliver = deliver;
    this.ended = ended;
  }

  send(data: string) {
    if (this.readyState === WebSocket.OPEN) this.deliver(data);
  }
  terminate() {
    this.close(1013);
  }
  close(code = 1000) {
    if (this.readyState !== WebSocket.OPEN) return;
    this.readyState = WebSocket.CLOSED;
    this.queue.length = 0;
    this.bufferedAmount = 0;
    this.emit("close");
    this.ended(code);
  }
}

/** Splits a large output message into small ones without cutting a surrogate pair. */
function splitOutput(data: string): string[] {
  const parsed = JSON.parse(data);
  if (parsed.type !== "output" || typeof parsed.data !== "string") return [data];
  const text: string = parsed.data;
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 8192, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    parts.push(JSON.stringify({ type: "output", data: text.slice(start, end) }));
    start = end;
  }
  return parts;
}

const host = globalThis as typeof globalThis & {
  projectorSharedServers?: WeakSet<Server | HttpServer>;
};
const servers = (host.projectorSharedServers ??= new WeakSet());
export function attachSharedTerminalServer(server: Server | HttpServer): void {
  if (servers.has(server)) return;
  servers.add(server);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 128 * 1024,
    perMessageDeflate: false,
  });
  protectLanSockets(server, wss);
  const alive = new WeakSet<WebSocket>();
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!alive.has(socket)) socket.terminate();
      else {
        alive.delete(socket);
        socket.ping();
      }
    }
  }, 30000);
  heartbeat.unref();
  server.once("close", () => {
    clearInterval(heartbeat);
    for (const socket of wss.clients) socket.terminate();
    wss.close();
  });
  server.on("upgrade", (req, socket, head) => {
    if (socket.destroyed || socket.writableEnded) return;
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      return;
    }
    if (url.pathname !== "/api/terminal/shared") return;
    const kind = url.searchParams.get("kind");
    if (!accessAllowed(req, true, url.searchParams.get("token") ?? undefined)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    if (kind !== "control" && kind !== "data") {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit("connection", client, req);
      alive.add(client);
      client.on("pong", () => alive.add(client));
      client.on("error", () => client.terminate());
      bind(client, kind);
    });
  });
}

function bind(socket: WebSocket, kind: "control" | "data") {
  const channels = new Map<string, Channel>();
  const opening = new Map<string, object>();
  let pumping: ReturnType<typeof setTimeout> | undefined;
  let cursor = 0;
  const send = (message: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  // One frame per channel per pass. Never put an unbounded output burst into ws/TCP.
  const pump = () => {
    pumping = undefined;
    if (socket.readyState !== WebSocket.OPEN) return;
    const peers = [...channels.values()];
    const start = cursor;
    for (let step = 0; step < peers.length; step++) {
      if (socket.bufferedAmount > 256 * 1024) break;
      const index = (start + step) % peers.length;
      cursor = (index + 1) % peers.length;
      const channel = peers[index]!;
      const frame = channel.queue.shift();
      if (frame) {
        channel.bufferedAmount -= frame.length;
        socket.send(frame);
      }
    }
    if ([...channels.values()].some((channel) => channel.queue.length))
      pumping = setTimeout(pump, socket.bufferedAmount > 256 * 1024 ? 10 : 1);
  };
  const snapshot = (peer: Channel) =>
    peer.send(JSON.stringify({ type: "sessions", sessions: listTerminalSessions(peer.projectId) }));
  const dirty = new Set<string>();
  const unsubscribe =
    kind === "control"
      ? onTerminalSessionsChanged((projectId) => {
          if (dirty.has(projectId)) return;
          dirty.add(projectId);
          queueMicrotask(() => {
            dirty.delete(projectId);
            // Compute process activity once per project, not once per browser subscriber.
            const peers = [...channels.values()].filter((peer) => peer.projectId === projectId);
            if (!peers.length) return;
            const data = JSON.stringify({
              type: "sessions",
              sessions: listTerminalSessions(projectId),
            });
            for (const peer of peers) peer.send(data);
          });
        })
      : () => {};
  socket.on("close", () => {
    unsubscribe();
    clearTimeout(pumping);
    opening.clear();
    for (const peer of channels.values()) peer.close(1001);
    channels.clear();
  });
  socket.on("message", (raw, binary) => {
    try {
      if (binary) throw new Error("Ожидается JSON");
      const message = JSON.parse(raw.toString());
      const id = message.channel;
      if (typeof id !== "string" || !id || id.length > 100) throw new Error("Некорректный канал");
      if (message.type === "close") {
        opening.delete(id);
        channels.get(id)?.close();
        return;
      }
      if (message.type === "open") {
        if (channels.has(id) || opening.has(id)) return;
        if (
          channels.size + opening.size >= 256 ||
          typeof message.projectId !== "string" ||
          (kind === "data" && typeof message.sessionId !== "string")
        )
          throw new Error("Некорректная подписка");
        const attempt = {};
        opening.set(id, attempt);
        void findProject(message.projectId)
          .then((project) => {
            if (opening.get(id) !== attempt || socket.readyState !== WebSocket.OPEN) return;
            opening.delete(id);
            if (!project) {
              // 4404 is not a normal close: owners must not retry or treat it as an ended session.
              send({ type: "closed", channel: id, code: 4404 });
              return;
            }
            const peer = new Channel(
              project.id,
              (data) => {
                // The JSON string is never shorter than its payload: small messages pass through.
                const messages = data.length > 8192 ? splitOutput(data) : [data];
                for (const item of messages) {
                  const frame = JSON.stringify({ type: "message", channel: id, data: item });
                  peer.queue.push(frame);
                  peer.bufferedAmount += frame.length;
                }
                if (peer.bufferedAmount > 2 * 1024 * 1024) peer.terminate();
                else if (!pumping) pumping = setTimeout(pump, 0);
              },
              (code) => {
                channels.delete(id);
                send({ type: "closed", channel: id, code });
              },
            );
            channels.set(id, peer);
            try {
              if (kind === "data") subscribeTerminalPeer(project.id, message.sessionId, peer);
              send({ type: "opened", channel: id });
              if (kind === "control") snapshot(peer);
              let queue = Promise.resolve();
              let queued = 0;
              peer.on("message", (data: string) => {
                if (kind === "data") return;
                if (++queued > 64) {
                  peer.terminate();
                  return;
                }
                queue = queue.then(async () => {
                  --queued;
                  if (peer.readyState !== WebSocket.OPEN) return;
                  let requestId: unknown;
                  try {
                    const request = JSON.parse(data);
                    requestId = request.id;
                    if (
                      !Number.isSafeInteger(requestId) ||
                      !["GET", "POST", "DELETE"].includes(request.method) ||
                      (request.sessionId !== undefined && typeof request.sessionId !== "string") ||
                      (request.link !== undefined && typeof request.link !== "string") ||
                      (request.body !== undefined &&
                        (!request.body ||
                          typeof request.body !== "object" ||
                          Array.isArray(request.body)))
                    )
                      throw new Error("Некорректный запрос терминала");
                    const result = await terminalControl(
                      project.id,
                      request.method,
                      request.sessionId,
                      request.body,
                      request.link,
                    );
                    peer.send(JSON.stringify({ type: "response", id: requestId, data: result }));
                  } catch (error) {
                    peer.send(
                      JSON.stringify({
                        type: "response",
                        id: requestId,
                        data: {
                          error: error instanceof Error ? error.message : "Ошибка терминала",
                        },
                      }),
                    );
                  }
                });
              });
            } catch {
              peer.close(1000);
            }
          })
          .catch(() => {
            if (opening.get(id) !== attempt) return;
            opening.delete(id);
            send({ type: "closed", channel: id, code: 1011 });
          });
        return;
      }
      if (
        message.type !== "send" ||
        typeof message.data !== "string" ||
        message.data.length > 96 * 1024
      )
        throw new Error("Некорректное сообщение");
      channels.get(id)?.emit("message", message.data, false);
    } catch {
      socket.close(1008, "Invalid channel message");
    }
  });
}
