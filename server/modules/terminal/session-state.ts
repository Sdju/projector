import type { Server } from "node:http";
import type { HttpServer } from "vite";
import { type IPty } from "node-pty";
import headless from "@xterm/headless";
import serialization from "@xterm/addon-serialize";
import { WebSocket } from "ws";
import type {
  TerminalServerMessage,
  TerminalSession,
} from "../../../core/modules/terminal/index.ts";
import { trackMouseEncoding } from "./terminal-mouse.ts";

const { Terminal } = headless;
const { SerializeAddon } = serialization;

export const MAX_SESSIONS = 24;
export const MAX_BUFFER = 1024 * 1024;

export interface Session {
  info: TerminalSession;
  pty: IPty;
  screen: InstanceType<typeof Terminal>;
  serialize: InstanceType<typeof SerializeAddon>;
  mouseEncoding: ReturnType<typeof trackMouseEncoding>;
  clients: Set<WebSocket>;
  pending: Map<WebSocket, number>;
  queued: number;
  paused: boolean;
  disposed: boolean;
  droppedDirectories?: Set<string>;
}

const host = globalThis as typeof globalThis & {
  projectorTerminals?: {
    sessions: Map<string, Session>;
    servers: WeakSet<Server | HttpServer>;
    hooksBound: boolean;
  };
};
export const state = (host.projectorTerminals ??= {
  sessions: new Map(),
  servers: new WeakSet(),
  hooksBound: false,
});
for (const session of state.sessions.values()) {
  session.pending ??= new Map();
  session.queued ??= 0;
  session.paused ??= false;
  session.mouseEncoding ??= trackMouseEncoding(session.screen);
}

export function size(cols: unknown, rows: unknown): { cols: number; rows: number } {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    Number(cols) < 2 ||
    Number(cols) > 500 ||
    Number(rows) < 2 ||
    Number(rows) > 200
  ) {
    throw new Error("Некорректный размер терминала");
  }
  return { cols: Number(cols), rows: Number(rows) };
}

export function send(client: WebSocket, message: TerminalServerMessage): void {
  if (client.readyState !== WebSocket.OPEN) return;
  // A slow client reconnects to a fresh screen instead of accumulating output.
  if (client.bufferedAmount > MAX_BUFFER) {
    client.terminate();
    return;
  }
  client.send(JSON.stringify(message));
}

export function broadcast(session: Session, message: TerminalServerMessage): void {
  for (const client of session.clients) {
    send(client, message);
    if (message.type === "output" && client.readyState === WebSocket.OPEN) {
      session.pending.set(client, (session.pending.get(client) ?? 0) + message.data.length);
    }
  }
  flow(session);
}

export function flow(session: Session): void {
  if (session.disposed || session.info.status !== "running") return;
  const pending = [...session.pending.values()];
  if (
    !session.paused &&
    (session.queued > MAX_BUFFER / 4 || pending.some((length) => length > MAX_BUFFER / 4))
  ) {
    session.paused = true;
    session.pty.pause();
  } else if (
    session.paused &&
    session.queued < MAX_BUFFER / 16 &&
    pending.every((length) => length < MAX_BUFFER / 16)
  ) {
    session.paused = false;
    session.pty.resume();
  }
}
