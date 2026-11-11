import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { WebSocket, createWebSocketStream } from "ws";
import {
  HUB_PROTOCOL,
  isDeviceId,
  type HubConnection,
  type HubDevice,
} from "@ai-projector/core/modules/hub/index.ts";
import { markHubSocket } from "../access/index.ts";
import { broadcastEvent } from "../events/index.ts";

const MAX_DEVICES = 128;

/** The Hub is trusted, but a malformed snapshot must not reach pages as a source list. */
function hubDevices(value: unknown): HubDevice[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_DEVICES) return undefined;
  const devices: HubDevice[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const { id, name, protocol, online } = item as Record<string, unknown>;
    if (
      !isDeviceId(id) ||
      typeof name !== "string" ||
      typeof protocol !== "number" ||
      typeof online !== "boolean"
    )
      return undefined;
    devices.push({ id, name, protocol, online });
  }
  return devices;
}

// Vite reloads the module while the Hub connector may stay open: share the publisher.
const host = globalThis as typeof globalThis & { projectorHubPublisher?: () => void };

/** A one-line signal to the Hub: this device's jobs or runs changed. No-op without a Hub. */
export function publishHubActivity(): void {
  host.projectorHubPublisher?.();
}

export interface HubHandlers {
  handle(req: IncomingMessage, res: ServerResponse): void;
  attach(server: Server): () => void;
}
export function connectHub(
  config: HubConnection,
  handlers: HubHandlers,
  status: (online: boolean, error?: string) => void,
): () => void {
  const ingress = createServer((req, res) => handlers.handle(req, res));
  const detach = handlers.attach(ingress);
  const peers = new Set<WebSocket>();
  let disposed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let control: WebSocket | undefined;
  let publisher: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let delay = 1000;
  const origin = new URL(config.url).origin;
  const endpoint = (stream?: string) => {
    const url = new URL("/api/hub/connect", config.url);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (stream) url.searchParams.set("stream", stream);
    else {
      url.searchParams.set("device", config.deviceId);
      url.searchParams.set("protocol", String(HUB_PROTOCOL));
    }
    return url;
  };
  const options = {
    headers: { Authorization: `Bearer ${config.token}` },
    handshakeTimeout: 10000,
    maxPayload: 256 * 1024,
    perMessageDeflate: false,
  };
  const open = () => {
    if (disposed) return;
    const ws = (control = new WebSocket(endpoint(), options));
    const publish = () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify({ type: "activity", at: Date.now() }));
      } catch {
        // The close handler reconnects; the page fallback reads the jobs meanwhile.
      }
    };
    publisher = publish;
    host.projectorHubPublisher = publish;
    const arm = () => {
      clearTimeout(heartbeat);
      heartbeat = setTimeout(() => ws.terminate(), 45000);
      heartbeat.unref();
    };
    ws.on("open", arm);
    ws.on("ping", arm);
    let failure: string | undefined;
    ws.on("unexpected-response", (_req, res) => {
      failure =
        res.statusCode === 401
          ? "Hub отклонил токен подключения"
          : res.statusCode === 409
            ? "ID устройства занят или версия протокола несовместима"
            : "Hub отклонил подключение";
      res.resume();
      ws.terminate();
    });
    ws.on("error", () => {
      failure ??= "Не удалось соединиться с Hub";
      ws.terminate();
    });
    ws.on("message", (data) => {
      if (!Buffer.isBuffer(data)) {
        ws.terminate();
        return;
      }
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "ready" && message.protocol === HUB_PROTOCOL) {
          delay = 1000;
          status(true);
          // The Hub may have missed changes while the link was down: let other devices read us.
          publish();
          return;
        }
        if (message.type === "hub-event") {
          if (message.event === "devices") {
            const devices = hubDevices(message.devices);
            if (devices) broadcastEvent("hub-devices", { devices });
          } else if (
            message.event === "activity" &&
            typeof message.deviceId === "string" &&
            typeof message.at === "number" &&
            Number.isFinite(message.at)
          ) {
            broadcastEvent("hub-activity", { deviceId: message.deviceId, at: message.at });
          }
          return;
        }
        if (
          message.type !== "open" ||
          typeof message.id !== "string" ||
          !/^[a-f0-9]{64}$/.test(message.id) ||
          peers.size >= 128
        )
          return;
        const peer = new WebSocket(endpoint(message.id), options);
        peers.add(peer);
        peer.on("error", () => peer.terminate());
        peer.once("close", () => peers.delete(peer));
        peer.once("open", () => {
          const stream = createWebSocketStream(peer);
          stream.on("error", () => stream.destroy());
          markHubSocket(stream, origin);
          ingress.emit("connection", stream);
        });
      } catch {
        ws.terminate();
      }
    });
    ws.once("close", () => {
      clearTimeout(heartbeat);
      if (host.projectorHubPublisher === publish) host.projectorHubPublisher = undefined;
      status(
        false,
        disposed ? undefined : (failure ?? "Соединение с Hub потеряно, повторяем подключение"),
      );
      for (const peer of peers) peer.terminate();
      if (!disposed) {
        retry = setTimeout(open, delay + Math.random() * 500);
        retry.unref();
        delay = Math.min(delay * 2, 30000);
      }
    });
  };
  open();
  return () => {
    disposed = true;
    if (host.projectorHubPublisher === publisher) host.projectorHubPublisher = undefined;
    publisher = undefined;
    clearTimeout(retry);
    clearTimeout(heartbeat);
    control?.terminate();
    for (const peer of peers) peer.terminate();
    detach();
    ingress.close();
    status(false);
  };
}
