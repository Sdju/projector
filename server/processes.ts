import { spawn, type ChildProcess } from "node:child_process";
import { projectAppUrl } from "./paths.ts";
import type { LaunchMode, LogLine, ProcessSnapshot, ProcessStatus, Project } from "./types.ts";
import { openWindow } from "./window.ts";

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+[^\s)]*/i;
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[mK]`, "g");

interface Session {
  project: Project;
  commandId: string;
  commandName: string;
  child: ChildProcess;
  status: ProcessStatus;
  url: string | null;
  startedAt: string;
  exitCode: number | null;
  pendingWindow: boolean;
  logs: LogLine[];
  leftover: { stdout: string; stderr: string };
}

type Listener = (event: string, data: unknown) => void;

// Vite reloads the API modules without stopping their child processes.
// Keep ownership and snapshots across those reloads to avoid duplicate starts.
const host = globalThis as typeof globalThis & {
  projectorProcesses?: { sessions: Map<string, Session>; listeners: Set<Listener>; hooksBound: boolean };
};
const state = host.projectorProcesses ??= {
  sessions: new Map<string, Session>(), listeners: new Set<Listener>(), hooksBound: false,
};
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
    pid: session.child.pid ?? null,
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

function pushLog(session: Session, stream: LogLine["stream"], text: string): void {
  const line: LogLine = {
    projectId: session.project.id,
    stream,
    text,
    at: new Date().toISOString(),
  };
  session.logs.push(line);
  if (session.logs.length > 800) session.logs.splice(0, session.logs.length - 800);
  emit("log", line);
}

function consumeChunk(session: Session, stream: "stdout" | "stderr", chunk: string): void {
  const data = session.leftover[stream] + chunk.replace(ANSI_RE, "");
  const parts = data.split(/\r?\n/);
  session.leftover[stream] = parts.pop() ?? "";
  for (const part of parts) {
    if (!part) continue;
    pushLog(session, stream, part);
    const match = part.match(URL_RE);
    if (match) {
      session.url = match[0]
        .replace("0.0.0.0", "localhost")
        .replace("127.0.0.1", "localhost")
        .replace("[::1]", "localhost");
      session.status = "running";
      emit("status", snapshot(session));
      maybeOpenWindow(session);
    }
  }
}

function maybeOpenWindow(session: Session): void {
  if (!session.pendingWindow) return;
  const url = session.url || session.project.url;
  if (!url) return;
  session.pendingWindow = false;
  openWindow(projectAppUrl(session.project.id));
  pushLog(session, "system", `окно: ${url}`);
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (process.platform !== "win32") {
      process.kill(-child.pid, "SIGTERM");
    } else {
      child.kill();
    }
  } catch {
    child.kill();
  }
}

function spawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: "1",
    CI: process.env.CI || "true",
  };
  delete env.NO_COLOR;
  return env;
}

function bindExitHooks(): void {
  if (state.hooksBound) return;
  state.hooksBound = true;
  const stopAll = () => {
    for (const session of sessions.values()) killTree(session.child);
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

export function listSnapshots(): ProcessSnapshot[] {
  return [...sessions.values()].map(snapshot);
}

export function getSnapshot(projectId: string): ProcessSnapshot {
  const session = sessions.get(projectId);
  return session ? snapshot(session) : idleSnapshot(projectId);
}

export function getLogs(projectId: string): LogLine[] {
  return sessions.get(projectId)?.logs ?? [];
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

  bindExitHooks();

  const child = spawn(command.cmd, {
    cwd: project.path,
    shell: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: spawnEnv(),
  });

  const session: Session = {
    project,
    commandId: command.id,
    commandName: command.name,
    child,
    status: "starting",
    url: null,
    startedAt: new Date().toISOString(),
    exitCode: null,
    pendingWindow: (mode ?? project.mode) === "window",
    logs: [],
    leftover: { stdout: "", stderr: "" },
  };
  sessions.set(project.id, session);
  pushLog(session, "system", `$ ${command.cmd}`);
  emit("status", snapshot(session));

  child.stdout?.on("data", (buf: Buffer) => consumeChunk(session, "stdout", buf.toString("utf8")));
  child.stderr?.on("data", (buf: Buffer) => consumeChunk(session, "stderr", buf.toString("utf8")));
  child.on("error", (error) => {
    session.status = "error";
    pushLog(session, "system", error.message);
    emit("status", snapshot(session));
  });
  child.on("close", (code) => {
    session.exitCode = code;
    if (session.status !== "stopping" && code && code !== 0) {
      session.status = "error";
      pushLog(session, "system", `завершилось с кодом ${code}`);
    } else {
      session.status = "idle";
      pushLog(session, "system", "остановлено");
    }
    emit("status", snapshot(session));
  });

  if (session.pendingWindow && project.url) {
    setTimeout(() => {
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
  killTree(session.child);
  setTimeout(() => {
    if (session.status === "stopping" && session.child.pid) {
      try {
        process.kill(-session.child.pid, "SIGKILL");
      } catch {
        session.child.kill("SIGKILL");
      }
    }
  }, 2500);
  return snapshot(session);
}
