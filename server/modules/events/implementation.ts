import type { IncomingMessage, ServerResponse } from "node:http";

import { onProcessEvent } from "../processes/index.ts";

interface SseClient {
  res: ServerResponse;
  id: string;
}

type CloseListener = (clientId: string) => void;

// Vite reloads the API modules without closing open event streams: keep the clients across reloads.
const host = globalThis as typeof globalThis & {
  projectorEvents?: { clients: Set<SseClient>; closeListeners: Set<CloseListener>; bound: boolean };
};
const state = (host.projectorEvents ??= {
  clients: new Set<SseClient>(),
  closeListeners: new Set<CloseListener>(),
  bound: false,
});
const { clients: sseClients, closeListeners } = state;

export function bindEvents(): void {
  if (state.bound) return;
  state.bound = true;
  onProcessEvent((event, data) => broadcastEvent(event, data));
}

/** Sends an event to every open stream; with `clientId` only to that page. */
export function broadcastEvent(event: string, data: unknown, clientId?: string): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients)
    if (!clientId || client.id === clientId) client.res.write(payload);
}

/** Called when a page's stream closes: owners of per-page resources release them. */
export function onEventClientClose(listener: CloseListener): () => void {
  closeListeners.add(listener);
  return () => {
    closeListeners.delete(listener);
  };
}

export function attachSse(req: IncomingMessage, res: ServerResponse): void {
  bindEvents();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write(":\n\n");
  const client = {
    res,
    id: new URL(req.url ?? "/", "http://localhost").searchParams.get("client") ?? "",
  };
  sseClients.add(client);
  req.on("close", () => {
    sseClients.delete(client);
    if (client.id) for (const listener of closeListeners) listener(client.id);
  });
}

export function notifyLauncherShow() {
  broadcastEvent("launcher-show", {});
}
