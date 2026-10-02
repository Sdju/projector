import { readTerminalProcesses, terminalActivity } from "./terminal-activity.ts";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { HttpServer } from "vite";
import { spawn, type IPty } from "node-pty";
import headless from "@xterm/headless";
import serialization from "@xterm/addon-serialize";
import { WebSocket, WebSocketServer } from "ws";
import type {
  TerminalProgram,
  TerminalServerMessage,
  TerminalSession,
} from "../../../core/modules/terminal/index.ts";
import { loadProjects } from "../projects/index.ts";
import type { Project } from "../projects/index.ts";
import { trackMouseEncoding } from "./terminal-mouse.ts";

const { Terminal } = headless;
const { SerializeAddon } = serialization;
const MAX_SESSIONS = 24;
const MAX_BUFFER = 1024 * 1024;

interface Session {
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
}

const host = globalThis as typeof globalThis & {
  projectorTerminals?: {
    sessions: Map<string, Session>;
    servers: WeakSet<Server | HttpServer>;
    hooksBound: boolean;
  };
};
const state = (host.projectorTerminals ??= {
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

export function terminalRequestAllowed(req: IncomingMessage, requireOrigin = true): boolean {
  try {
    const url = new URL(`http://${req.headers.host}`);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
    const origin = req.headers.origin;
    // Browser WebSocket handshakes must have an exact same-origin header.
    if (!origin) return !requireOrigin;
    return (
      origin ===
      `${"encrypted" in req.socket && req.socket.encrypted ? "https:" : "http:"}//${url.host}`
    );
  } catch {
    return false;
  }
}

function size(cols: unknown, rows: unknown): { cols: number; rows: number } {
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

function send(client: WebSocket, message: TerminalServerMessage): void {
  if (client.readyState !== WebSocket.OPEN) return;
  // A slow client reconnects to a fresh screen instead of accumulating output.
  if (client.bufferedAmount > MAX_BUFFER) {
    client.terminate();
    return;
  }
  client.send(JSON.stringify(message));
}

function broadcast(session: Session, message: TerminalServerMessage): void {
  for (const client of session.clients) {
    send(client, message);
    if (message.type === "output" && client.readyState === WebSocket.OPEN) {
      session.pending.set(client, (session.pending.get(client) ?? 0) + message.data.length);
    }
  }
  flow(session);
}

function flow(session: Session): void {
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

export function listTerminalSessions(projectId: string): TerminalSession[] {
  const processes = readTerminalProcesses();
  return [...state.sessions.values()]
    .filter((session) => session.info.projectId === projectId)
    .map((session) => ({
      ...session.info,
      activity: terminalActivity(session.info, processes),
    }));
}

export function renameTerminalSession(
  projectId: string,
  id: string,
  title: string,
): TerminalSession {
  const session = state.sessions.get(id);
  if (!session || session.info.projectId !== projectId) throw new Error("Терминал не найден");
  session.info.customTitle = title;
  broadcast(session, { type: "status", session: { ...session.info } });
  return { ...session.info };
}

export function terminalSessionSnapshot(
  projectId: string,
  id: string,
): TerminalSession | undefined {
  const session = state.sessions.get(id);
  if (!session || session.info.projectId !== projectId) return;
  return {
    ...session.info,
    activity: terminalActivity(session.info, readTerminalProcesses()),
  };
}

// Capture descendants before stopping the shell; interactive jobs have their own
// process groups and would otherwise survive killing only the PTY leader.
function descendants(pid: number): Array<{ pid: number; started: string }> {
  if (process.platform !== "linux") return [];
  const processes = readdirSync("/proc")
    .filter((name) => /^\d+$/.test(name))
    .flatMap((name) => {
      try {
        const stat = readFileSync(`/proc/${name}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        return [{ pid: Number(name), parent: Number(fields[1]), started: fields[19] }];
      } catch {
        return [];
      }
    });
  const family = new Set([pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of processes) {
      if (family.has(entry.parent) && !family.has(entry.pid)) {
        family.add(entry.pid);
        changed = true;
      }
    }
  }
  return processes.filter((entry) => family.has(entry.pid));
}

function terminate(session: Session, immediate = false): void {
  if (session.info.status !== "running") return;
  const family = descendants(session.pty.pid);
  for (const entry of family.reverse()) {
    try {
      process.kill(entry.pid, immediate ? "SIGKILL" : "SIGTERM");
    } catch {
      /* Already exited. */
    }
  }
  try {
    session.pty.kill(immediate ? "SIGKILL" : "SIGTERM");
  } catch {
    /* Already exited. */
  }
  if (immediate) return;
  const timer = setTimeout(() => {
    for (const entry of family) {
      try {
        const stat = readFileSync(`/proc/${entry.pid}/stat`, "utf8");
        if (stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] === entry.started) {
          for (const child of descendants(entry.pid).reverse()) {
            try {
              process.kill(child.pid, "SIGKILL");
            } catch {
              /* Already exited. */
            }
          }
          process.kill(entry.pid, "SIGKILL");
        }
      } catch {
        /* Already exited; never kill a reused pid. */
      }
    }
    if (process.platform !== "linux" && session.info.status === "running") {
      try {
        session.pty.kill("SIGKILL");
      } catch {
        /* Already exited. */
      }
    }
  }, 1500);
  timer.unref();
}

export function stopTerminalSession(projectId: string, id: string): void {
  const session = state.sessions.get(id);
  if (!session || session.info.projectId !== projectId) throw new Error("Терминал не найден");
  if (session.info.status === "exited" || session.info.stopRequested) return;
  session.info.stopRequested = true;
  broadcast(session, { type: "status", session: { ...session.info } });
  terminate(session);
}

export function closeTerminalSession(projectId: string, id: string): void {
  const session = state.sessions.get(id);
  if (!session || session.info.projectId !== projectId) throw new Error("Терминал не найден");
  terminate(session);
  session.disposed = true;
  for (const client of session.clients) client.close(1000, "Session closed");
  session.clients.clear();
  session.screen.dispose();
  state.sessions.delete(id);
}

export function closeProjectTerminals(projectId: string): void {
  for (const session of listTerminalSessions(projectId))
    closeTerminalSession(projectId, session.id);
}

export function createTerminalSession(
  project: Project,
  input: Record<string, unknown>,
  observer?: { output: (data: string) => void; exit: (code: number) => void },
  replacingId?: string,
): TerminalSession {
  const previous = replacingId ? state.sessions.get(replacingId) : undefined;
  if (replacingId && (!previous || previous.info.projectId !== project.id))
    throw new Error("Терминал не найден");
  if (previous && previous.info.status !== "exited") throw new Error("Сначала завершите сессию");
  if (!previous && state.sessions.size >= MAX_SESSIONS)
    throw new Error("Лимит терминалов: закройте ненужные сессии");
  const program = (input.program ?? "shell") as TerminalProgram;
  if (!["shell", "codex", "claude"].includes(program)) throw new Error("Неизвестная программа");
  const command =
    input.commandId === undefined
      ? undefined
      : project.commands.find((item) => item.id === input.commandId);
  if (input.commandId !== undefined && !command) throw new Error("Команда не найдена");
  const dimensions = size(
    input.cols ?? previous?.info.cols ?? 80,
    input.rows ?? previous?.info.rows ?? 24,
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.CI;
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  const shell = process.env.SHELL || "/bin/bash";
  const args = command
    ? ["-c", command.cmd]
    : program === "shell"
      ? ["-i"]
      : ["-i", "-c", `exec ${program}`];
  const screen = new Terminal({ ...dimensions, scrollback: 5000, allowProposedApi: true });
  const serialize = new SerializeAddon();
  screen.loadAddon(serialize);
  const mouseEncoding = trackMouseEncoding(screen);
  let child: IPty;
  try {
    child = spawn(shell, args, { name: "xterm-256color", ...dimensions, cwd: project.path, env });
  } catch (error) {
    screen.dispose();
    throw error;
  }
  const session: Session = {
    info: {
      id: randomUUID(),
      projectId: project.id,
      program,
      commandId: command?.id,
      customTitle: previous?.info.customTitle,
      title:
        command?.name ??
        (program === "shell" ? "Shell" : program === "codex" ? "Codex" : "Claude Code"),
      pid: child.pid,
      ...dimensions,
      status: "running",
      exitCode: null,
      startedAt: new Date().toISOString(),
    },
    pty: child,
    screen,
    serialize,
    mouseEncoding,
    clients: new Set(),
    pending: new Map(),
    queued: 0,
    paused: false,
    disposed: false,
  };
  state.sessions.set(session.info.id, session);
  // Parse before publishing, so reconnect snapshots and subsequent output form
  // one ordered stream, including alternate screen and cursor state.
  child.onData((data) => {
    if (session.disposed) return;
    observer?.output(data);
    session.queued += data.length;
    flow(session);
    screen.write(data, () => {
      session.queued -= data.length;
      if (!session.disposed) broadcast(session, { type: "output", data });
    });
  });
  child.onExit(({ exitCode }) => {
    session.info.status = "exited";
    session.info.exitCode = exitCode;
    observer?.exit(exitCode);
    if (!session.disposed)
      screen.write("", () => broadcast(session, { type: "status", session: { ...session.info } }));
  });
  if (!state.hooksBound) {
    state.hooksBound = true;
    const stopAll = () => {
      for (const item of state.sessions.values()) terminate(item, true);
    };
    process.on("exit", stopAll);
    process.on("SIGINT", () => {
      stopAll();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      stopAll();
      process.exit(0);
    });
  }
  if (previous) {
    const ordered = [...state.sessions.entries()]
      .filter(([id]) => id !== session.info.id)
      .map(([id, item]) =>
        id === previous.info.id ? ([session.info.id, session] as const) : ([id, item] as const),
      );
    closeTerminalSession(project.id, previous.info.id);
    state.sessions.clear();
    for (const [id, item] of ordered) state.sessions.set(id, item);
  }
  return { ...session.info };
}

export function attachTerminalServer(server: Server | HttpServer): void {
  if (state.servers.has(server)) return;
  state.servers.add(server);
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });
  const alive = new WeakSet<WebSocket>();
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
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/terminal/socket") return; // Leave Vite HMR alone.
    if (!terminalRequestAllowed(req)) {
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
