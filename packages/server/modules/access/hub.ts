import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

// Only the authenticated connector can mark a socket. HTTP headers never establish trust.
const state = globalThis as typeof globalThis & { projectorHubSockets?: WeakMap<Duplex, string> };
const sockets = (state.projectorHubSockets ??= new WeakMap());

export function markHubSocket(socket: Duplex, origin: string): void {
  sockets.set(socket, origin);
}

export function isHubRequest(req: IncomingMessage): boolean {
  return sockets.has(req.socket);
}

export function hubAccessAllowed(req: IncomingMessage, requireOrigin: boolean): boolean {
  const origin = sockets.get(req.socket);
  if (!origin || req.headers.host !== new URL(origin).host) return false;
  if (requireOrigin && !req.headers.origin) return false;
  if (req.headers.origin && req.headers.origin !== origin) return false;
  return (req.url ?? "").startsWith("/api/");
}
