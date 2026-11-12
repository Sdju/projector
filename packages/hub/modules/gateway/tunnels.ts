import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, createWebSocketStream } from "ws";
import { HUB_PROTOCOL, isDeviceId, type HubDevice } from "@ai-projector/core/modules/hub/index.ts";

interface Device {
  info: HubDevice;
  socket: WebSocket;
  streams: Set<Duplex>;
}
interface Pending {
  device: Device;
  resolve: (stream: Duplex) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const hash = (value: string) => createHash("sha256").update(value).digest();
export class Tunnels {
  readonly devices = new Map<string, Device>();
  private known = new Map<string, HubDevice>();
  list(): HubDevice[] {
    return [...this.known.values()];
  }
  private pending = new Map<string, Pending>();
  private sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 256 * 1024,
    perMessageDeflate: false,
  });
  private alive = new WeakSet<WebSocket>();
  private token: Buffer;
  private heartbeat: ReturnType<typeof setInterval>;
  constructor(token: string) {
    this.token = hash(token);
    this.heartbeat = setInterval(() => {
      for (const socket of this.sockets.clients) {
        if (!this.alive.has(socket)) {
          socket.terminate();
          continue;
        }
        this.alive.delete(socket);
        socket.ping();
      }
    }, 15000);
    this.heartbeat.unref();
  }
  accepts(token: string): boolean {
    return timingSafeEqual(hash(token), this.token);
  }
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (!this.accepts(token)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const ticket = url.searchParams.get("stream");
    const pending = ticket ? this.pending.get(ticket) : undefined;
    const id = url.searchParams.get("device");
    if (
      ticket
        ? !pending
        : !isDeviceId(id) ||
          this.devices.has(id) ||
          (!this.known.has(id!) && this.known.size >= 128) ||
          url.searchParams.get("protocol") !== String(HUB_PROTOCOL)
    ) {
      socket.end("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n");
      return;
    }
    this.sockets.handleUpgrade(req, socket, head, (ws) => {
      this.alive.add(ws);
      ws.on("pong", () => this.alive.add(ws));
      ws.on("error", () => ws.terminate());
      if (pending && ticket) {
        clearTimeout(pending.timer);
        this.pending.delete(ticket);
        const stream = createWebSocketStream(ws);
        stream.on("error", () => stream.destroy());
        pending.device.streams.add(stream);
        stream.once("close", () => pending.device.streams.delete(stream));
        pending.resolve(stream);
        return;
      }
      const device: Device = {
        info: { id: id!, name: id!, protocol: HUB_PROTOCOL, online: true },
        socket: ws,
        streams: new Set(),
      };
      this.devices.set(id!, device);
      this.known.set(id!, device.info);
      ws.once("close", () => {
        if (this.devices.get(id!) !== device) return;
        this.devices.delete(id!);
        device.info.online = false;
        for (const stream of device.streams) stream.destroy();
        for (const [key, item] of this.pending)
          if (item.device === device) {
            clearTimeout(item.timer);
            this.pending.delete(key);
            item.reject(new Error("Устройство отключилось"));
          }
        this.broadcastDevices();
      });
      ws.on("message", (data) => {
        if (Buffer.isBuffer(data)) this.activity(device, data);
      });
      ws.send(JSON.stringify({ type: "ready", protocol: HUB_PROTOCOL }));
      this.broadcastDevices();
    });
  }
  open(id: string): Promise<Duplex> {
    const device = this.devices.get(id);
    if (!device || device.socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("Устройство недоступно"));
    const outstanding = [...this.pending.values()].filter((item) => item.device === device).length;
    if (device.streams.size + outstanding >= 128)
      return Promise.reject(new Error("Лимит соединений устройства"));
    return new Promise((resolve, reject) => {
      const ticket = randomBytes(32).toString("hex");
      const timer = setTimeout(() => {
        this.pending.delete(ticket);
        reject(new Error("Таймаут подключения устройства"));
      }, 10000);
      timer.unref();
      this.pending.set(ticket, { device, resolve, reject, timer });
      device.socket.send(JSON.stringify({ type: "open", id: ticket }));
    });
  }

  /** Control messages to devices are small JSON; a dead socket must not break the Hub. */
  private send(device: Device, message: unknown): void {
    if (device.socket.readyState !== WebSocket.OPEN) return;
    try {
      device.socket.send(JSON.stringify(message));
    } catch {
      device.socket.terminate();
    }
  }

  private broadcast(message: unknown, except?: string): void {
    for (const device of this.devices.values())
      if (device.info.id !== except) this.send(device, message);
  }

  /** Pages update their source list from this snapshot instead of polling the Hub. */
  private broadcastDevices(): void {
    this.broadcast({ type: "hub-event", event: "devices", devices: this.list() });
  }

  /** A device reports its own activity; other devices pass the fact to their pages. */
  private activity(device: Device, data: Buffer): void {
    if (data.length > 4096) return;
    let message: unknown;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    const { type, at } = message as { type?: unknown; at?: unknown };
    if (type !== "activity" || typeof at !== "number" || !Number.isFinite(at)) return;
    this.broadcast(
      { type: "hub-event", event: "activity", deviceId: device.info.id, at },
      device.info.id,
    );
  }
  bind(server: Server): void {
    server.once("close", () => this.close());
  }
  close(): void {
    clearInterval(this.heartbeat);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Hub остановлен"));
    }
    this.pending.clear();
    for (const ws of this.sockets.clients) ws.terminate();
    this.sockets.close();
  }
}
