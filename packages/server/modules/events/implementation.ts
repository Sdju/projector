import type { IncomingMessage, ServerResponse } from "node:http";

import { onProcessEvent } from "../processes/index.ts";

interface SseClient {
  res: ServerResponse;
  id: string;
  /** Pages served by this stream besides `id`: a shared worker keeps one stream for all of them. */
  pages?: Set<string>;
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
    if (!clientId || client.id === clientId || client.pages?.has(clientId))
      client.res.write(payload);
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
  const client: SseClient = {
    res,
    id: new URL(req.url ?? "/", "http://localhost").searchParams.get("client") ?? "",
  };
  sseClients.add(client);
  req.on("close", () => {
    sseClients.delete(client);
    for (const id of [client.id, ...(client.pages ?? [])])
      if (id) for (const listener of closeListeners) listener(id);
  });
}

/**
 * Binds pages to the stream `stream` or releases them: what a page owns (file watchers) lives
 * as long as the stream, or until the page is removed. False when the stream is gone.
 */
export function updateEventPages(stream: string, add: string[], remove: string[]): boolean {
  const client = [...sseClients].find((item) => item.id === stream);
  if (!client) return false;
  const pages = (client.pages ??= new Set());
  for (const id of add) if (id !== stream) pages.add(id);
  for (const id of remove)
    if (pages.delete(id)) for (const listener of closeListeners) listener(id);
  return true;
}

export function notifyLauncherShow() {
  broadcastEvent("launcher-show", {});
}

/** Whether a page has an open event stream, directly or bound to a shared one. */
export function hasEventClient(clientId: string): boolean {
  return [...sseClients].some((item) => item.id === clientId || item.pages?.has(clientId));
}
