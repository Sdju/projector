import { readTerminalProcesses, terminalActivity } from "./terminal-activity.ts";
import { randomUUID } from "node:crypto";
import { resolveTerminalPath } from "./link-files.ts";
import { rmSync } from "node:fs";
import { os } from "../../../core/modules/os/index.ts";
import { saveDroppedFile } from "./drop-files.ts";
import { HttpError } from "../http/index.ts";
import type { IncomingMessage } from "node:http";
import { spawn, type IPty } from "node-pty";
import headless from "@xterm/headless";
import serialization from "@xterm/addon-serialize";
import type { TerminalProgram, TerminalSession } from "../../../core/modules/terminal/index.ts";
import type { Project } from "../projects/index.ts";
import { trackMouseEncoding } from "./terminal-mouse.ts";
import { MAX_SESSIONS, state, size, broadcast, flow, type Session } from "./session-state.ts";

const { Terminal } = headless;
const { SerializeAddon } = serialization;

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

export async function resolveTerminalFile(project: Project, id: string, path: string) {
  const session = state.sessions.get(id);
  if (!session || session.info.projectId !== project.id)
    throw new HttpError(404, "Терминал не найден");
  const cwd =
    session.info.status === "running"
      ? await os.processes.workingDirectory(session.info.pid, project.path)
      : project.path;
  return resolveTerminalPath(path, project.path, cwd);
}

const descendants = (pid: number) => os.processes.descendants(pid);

function terminate(session: Session, immediate = false): void {
  if (session.info.status !== "running") return;
  const family = descendants(session.pty.pid);
  for (const entry of family.reverse()) {
    try {
      os.processes.signal(entry.pid, immediate ? "SIGKILL" : "SIGTERM");
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
        if (os.processes.identity(entry.pid) === entry.started) {
          for (const child of descendants(entry.pid).reverse()) {
            try {
              os.processes.signal(child.pid, "SIGKILL");
            } catch {
              /* Already exited. */
            }
          }
          os.processes.signal(entry.pid, "SIGKILL");
        }
      } catch {
        /* Already exited; never kill a reused pid. */
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

export async function uploadTerminalFile(
  projectId: string,
  id: string,
  req: IncomingMessage,
  name: string,
): Promise<string> {
  const session = state.sessions.get(id);
  if (!session || session.info.projectId !== projectId)
    throw new HttpError(404, "Терминал не найден");
  const available = () =>
    !session.disposed && session.info.status === "running" && !session.info.stopRequested;
  if (!available()) throw new HttpError(409, "Терминал больше не принимает файлы");
  return saveDroppedFile(req, name, available, (directory) => {
    (session.droppedDirectories ??= new Set()).add(directory);
  });
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
  for (const directory of session.droppedDirectories ?? [])
    rmSync(directory, { recursive: true, force: true });
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
  if (!["shell", "codex", "claude", "opencode"].includes(program))
    throw new Error("Неизвестная программа");
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
  const shell = os.shell();
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
        { shell: "Shell", codex: "Codex", claude: "Claude Code", opencode: "OpenCode" }[program],
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
