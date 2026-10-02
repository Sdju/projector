import type { IncomingMessage, ServerResponse } from "node:http";

import { onProcessEvent } from "../processes/index.ts";

interface SseClient {
  res: ServerResponse;
}

const sseClients = new Set<SseClient>();

let eventsBound = false;

export function bindEvents(): void {
  if (eventsBound) return;
  eventsBound = true;
  onProcessEvent((event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) client.res.write(payload);
  });
}

export function attachSse(req: IncomingMessage, res: ServerResponse): void {
  bindEvents();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write(":\n\n");
  const client = { res };
  sseClients.add(client);
  req.on("close", () => sseClients.delete(client));
}

export function notifyLauncherShow() {
  for (const client of sseClients) client.res.write("event: launcher-show\ndata: {}\n\n");
}
