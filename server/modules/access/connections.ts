import type { IncomingMessage } from "node:http";
import type { WebSocket, WebSocketServer } from "ws";
import { accessAllowed, isLocalRequest } from "./access.ts";
import { onLanPasswordChanged } from "./password.ts";

/** Revoke live LAN sockets as well as HTTP sessions when the password changes. */
export function protectLanSockets(
  server: {
    once(event: "close", listener: () => void): unknown;
    off?(event: "close", listener: () => void): unknown;
  },
  sockets: WebSocketServer,
  allowed: typeof accessAllowed = accessAllowed,
): () => void {
  const requests = new Map<WebSocket, IncomingMessage>();
  sockets.on("connection", (client, req) => {
    if (isLocalRequest(req)) return;
    requests.set(client, req);
    client.once("close", () => requests.delete(client));
  });
  const unsubscribe = onLanPasswordChanged(() => {
    for (const client of requests.keys()) client.terminate();
  });
  const timer = setInterval(() => {
    for (const [client, req] of requests) {
      const token =
        new URL(req.url ?? "/", "http://localhost").searchParams.get("token") ?? undefined;
      if (!allowed(req, true, token)) client.terminate();
    }
  }, 30000);
  timer.unref();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    unsubscribe();
    requests.clear();
    server.off?.("close", dispose);
  };
  server.once("close", dispose);
  return dispose;
}
