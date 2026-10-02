import { createTerminalSession, stopTerminalSession } from "./terminal.ts";
import type { TerminalSession } from "../shared/terminal.ts";
import { projectAppUrl } from "./paths.ts";
import type { LaunchMode, ProcessSnapshot, ProcessStatus, Project } from "./types.ts";
import { openWindow } from "./window.ts";

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+[^\s)]*/i;
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[mK]`, "g");

interface Session {
  project: Project;
  commandId: string;
  commandName: string;
  terminal: TerminalSession;
  status: ProcessStatus;
  url: string | null;
  startedAt: string;
  exitCode: number | null;
  pendingWindow: boolean;
  leftover: string;
}

type Listener = (event: string, data: unknown) => void;

// Vite reloads the API modules without stopping their child processes.
// Keep ownership and snapshots across those reloads to avoid duplicate starts.
const host = globalThis as typeof globalThis & {
  projectorProcesses?: { sessions: Map<string, Session>; listeners: Set<Listener> };
};
const state = (host.projectorProcesses ??= {
  sessions: new Map<string, Session>(),
  listeners: new Set<Listener>(),
});
const { sessions, listeners } = state;

export function onProcessEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: string, data: unknown): void {
  for (const listener of listeners) listener(event, data);
}

function snapshot(session: Session): ProcessSnapshot {
  return {
    projectId: session.project.id,
    commandId: session.commandId,
    commandName: session.commandName,
    status: session.status,
    pid: session.terminal.pid,
    url: session.url,
    startedAt: session.startedAt,
    exitCode: session.exitCode,
  };
}

function idleSnapshot(projectId: string): ProcessSnapshot {
  return {
    projectId,
    commandId: null,
    commandName: null,
    status: "idle",
    pid: null,
    url: null,
    startedAt: null,
    exitCode: null,
  };
}

function consumeChunk(session: Session, chunk: string): void {
  const data = session.leftover + chunk.replace(ANSI_RE, "");
  const lines = data.split(/\r?\n/);
  session.leftover = (lines.pop() ?? "").slice(-4096);
  for (const line of lines) {
    const match = line.match(URL_RE);
    if (!match) continue;
    const url = match[0]
      .replace("0.0.0.0", "localhost")
      .replace("127.0.0.1", "localhost")
      .replace("[::1]", "localhost");
    if (session.url === url) continue;
    session.url = url;
    emit("status", snapshot(session));
    maybeOpenWindow(session);
  }
}

function maybeOpenWindow(session: Session): void {
  if (!session.pendingWindow) return;
  const url = session.url || session.project.url;
  if (!url) return;
  session.pendingWindow = false;
  openWindow(projectAppUrl(session.project.id));
}

export function listSnapshots(): ProcessSnapshot[] {
  return [...sessions.values()].map(snapshot);
}

export function getSnapshot(projectId: string): ProcessSnapshot {
  const session = sessions.get(projectId);
  return session ? snapshot(session) : idleSnapshot(projectId);
}

export function startProject(
  project: Project,
  commandId?: string,
  mode?: LaunchMode,
): ProcessSnapshot {
  const current = sessions.get(project.id);
  if (current && (current.status === "running" || current.status === "starting")) {
    throw new Error("Проект уже запущен");
  }

  const command =
    project.commands.find((item) => item.id === (commandId ?? project.defaultCommandId)) ??
    project.commands[0];
  if (!command) throw new Error("Нет команды для запуска");

  let session: Session;
  const terminal = createTerminalSession(
    project,
    { program: "shell", commandId: command.id },
    {
      output: (data) => consumeChunk(session, data),
      exit: (code) => {
        session.exitCode = code;
        session.status = session.status !== "stopping" && code !== 0 ? "error" : "idle";
        emit("status", snapshot(session));
      },
    },
  );
  session = {
    project,
    commandId: command.id,
    commandName: command.name,
    terminal,
    status: "running",
    url: project.url || null,
    startedAt: terminal.startedAt,
    exitCode: null,
    pendingWindow: (mode ?? project.mode) === "window",
    leftover: "",
  };
  sessions.set(project.id, session);
  emit("status", snapshot(session));
  emit("terminal-started", { projectId: project.id, sessionId: terminal.id });

  if (session.pendingWindow && project.url) {
    setTimeout(() => {
      if (sessions.get(project.id) !== session || session.status !== "running") return;
      if (!session.url) session.url = project.url;
      maybeOpenWindow(session);
    }, 1600);
  }

  return snapshot(session);
}

export function stopProject(projectId: string): ProcessSnapshot {
  const session = sessions.get(projectId);
  if (!session || session.status === "idle") return idleSnapshot(projectId);

  session.status = "stopping";
  emit("status", snapshot(session));
  stopTerminalSession(projectId, session.terminal.id);
  return snapshot(session);
}
