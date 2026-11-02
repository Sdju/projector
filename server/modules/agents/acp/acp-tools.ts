import {
  SESSION_LIST_LIMIT,
  type AgentCommand,
  type AgentControl,
  type AgentSessionInfo,
  type AgentSessionTurn,
} from "../../agent/index.ts";
import type { AgentBackendId } from "../../agent/index.ts";
import type { AcpConnection } from "./acp-client.ts";
import { controlsFromSession } from "./acp-controls.ts";
import { availableCommands, createAcpReplayCollector } from "./acp-events.ts";
import { initializeAcp, startAcp, type AcpInitResult } from "./acp-process.ts";
import { acpProgram } from "./acp-programs.ts";

/** How long an agent's controls are reused: spawning an agent just to list models is not free. */
const CONTROLS_TTL_MS = 5 * 60_000;
const controlsCache = new Map<string, { at: number; controls: Promise<AgentControl[]> }>();

/**
 * Runs `work` against a short-lived agent process that is not tied to a chat turn. Permission
 * requests are refused: nothing here may run tools.
 */
async function withAgent<T>(
  id: AgentBackendId,
  cwd: string,
  work: (connection: AcpConnection, init: AcpInitResult) => Promise<T>,
  onUpdate?: (update: Record<string, unknown>) => void,
): Promise<T> {
  const connection = await startAcp(id, cwd, {
    onNotification(method, params) {
      if (method === "session/update") onUpdate?.((params.update ?? {}) as Record<string, unknown>);
    },
    onRequest() {
      return { outcome: { outcome: "cancelled" } };
    },
  });
  try {
    return await work(connection, await initializeAcp(connection, id));
  } finally {
    await connection.close();
  }
}

/** Drops the throwaway session so probing does not fill the agent's own history. */
async function discard(connection: AcpConnection, sessionId: string) {
  for (const method of ["session/delete", "session/close"] as const) {
    try {
      await connection.request(method, { sessionId }, 10_000);
      return;
    } catch {
      /* The agent may not implement this method; try the next one. */
    }
  }
}

/** Models, effort levels and modes the agent offers in `cwd`, cached for a few minutes. */
export function acpControls(id: AgentBackendId, cwd: string): Promise<AgentControl[]> {
  const key = `${id}\n${cwd}`;
  const cached = controlsCache.get(key);
  if (cached && Date.now() - cached.at < CONTROLS_TTL_MS) return cached.controls;
  const controls = withAgent(id, cwd, async (connection) => {
    const created = (await connection.request("session/new", { cwd, mcpServers: [] })) as {
      sessionId: string;
    };
    await discard(connection, created.sessionId);
    return controlsFromSession(created);
  });
  controlsCache.set(key, { at: Date.now(), controls });
  // A failure must not stick for the whole TTL.
  controls.catch(() => controlsCache.delete(key));
  return controls;
}

/** How long the slash commands are reused: they follow the project's files, not every call. */
const COMMANDS_TTL_MS = 60_000;
/** How long to wait for `available_commands_update` after `session/new`. */
const COMMANDS_WAIT_MS = 5_000;
const commandsCache = new Map<string, { at: number; commands: Promise<AgentCommand[]> }>();

/** Resolves with an empty list after `ms`: a chat must not wait for commands forever. */
function waitForCommands(commands: Promise<AgentCommand[]>, ms: number): Promise<AgentCommand[]> {
  return Promise.race([
    commands,
    new Promise<AgentCommand[]>((resolve) => {
      const timer = setTimeout(() => resolve([]), ms);
      timer.unref?.();
    }),
  ]);
}

/**
 * The slash commands the agent offers in `cwd`. ACP has no request for them: the agent sends
 * `available_commands_update` after `session/new`. A throwaway session is created for that list
 * and closed again — no prompt, no model call. The notification may arrive before the response
 * (the protocol allows it), so it is collected from the first message.
 */
export function acpCommands(
  id: AgentBackendId,
  cwd: string,
  waitMs = COMMANDS_WAIT_MS,
): Promise<AgentCommand[]> {
  const key = `${id}\n${cwd}`;
  const cached = commandsCache.get(key);
  if (cached && Date.now() - cached.at < COMMANDS_TTL_MS) return cached.commands;
  let resolveAnnounced: ((commands: AgentCommand[]) => void) | undefined;
  const announced = new Promise<AgentCommand[]>((resolve) => (resolveAnnounced = resolve));
  let collected: AgentCommand[] | undefined;
  let decided = false;
  const take = (list: unknown) => {
    collected = availableCommands(list);
    // An empty first snapshot is not final: some agents load commands from project files.
    if (collected.length) {
      decided = true;
      resolveAnnounced?.(collected);
    }
  };
  const commands = withAgent(
    id,
    cwd,
    async (connection) => {
      const created = (await connection.request("session/new", { cwd, mcpServers: [] })) as {
        sessionId: string;
        /** ACP v2 returns the list in the response; v1 sends the notification instead. */
        availableCommands?: unknown;
      };
      // The response is authoritative for v2 agents, even when the list is empty.
      if (created.availableCommands !== undefined) {
        take(created.availableCommands);
        decided = true;
      }
      if (!decided) await waitForCommands(announced, waitMs);
      await discard(connection, created.sessionId);
      return collected ?? [];
    },
    (update) => {
      if (update.sessionUpdate === "available_commands_update") take(update.availableCommands);
    },
  );
  commandsCache.set(key, { at: Date.now(), commands });
  // A failure must not stick for the whole TTL.
  commands.catch(() => commandsCache.delete(key));
  return commands;
}

const EMPTY_TITLE = /^(New session - \d{4}-\d\d-\d\dT|untitled|new session)$/i;

interface RawSession {
  sessionId?: string;
  title?: string | null;
  updatedAt?: string | null;
  /** Parent session: agents that expose subagent branches use their own field name. */
  parentId?: unknown;
  parentSessionId?: unknown;
  agent?: unknown;
  _meta?: Record<string, unknown> | null;
}

/** The session a raw one was started from, as far as the agent tells it. */
function parentOf(session: RawSession): string | undefined {
  const meta = session._meta ?? {};
  for (const value of [
    session.parentId,
    session.parentSessionId,
    meta.parentId,
    meta.parentSessionId,
    meta["opencode/parent-session"],
  ])
    if (typeof value === "string" && value.trim()) return value;
  return undefined;
}

/** The agent a branch runs as, when the listing names it. */
function agentOf(session: RawSession): string | undefined {
  const meta = session._meta ?? {};
  for (const value of [session.agent, meta.agent, meta["opencode/agent"]])
    if (typeof value === "string" && value.trim()) return value;
  return undefined;
}

/** Fills in what the ACP listing leaves out (OpenCode keeps parents only in its own storage). */
export type SessionDecorator = (sessions: AgentSessionInfo[]) => Promise<AgentSessionInfo[]>;

const newestFirst = (a: AgentSessionInfo, b: AgentSessionInfo) =>
  (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

/**
 * Branches of subagents are not chats of their own: they must not push real chats out of the
 * limited list. Their parents are kept in full, and branches follow those that remain.
 */
function capSessions(list: AgentSessionInfo[]): AgentSessionInfo[] {
  const mains = list.filter((session) => !session.parent);
  if (!mains.length) return list.sort(newestFirst).slice(0, SESSION_LIST_LIMIT);
  const children = new Map<string, AgentSessionInfo[]>();
  for (const session of list)
    if (session.parent)
      children.set(session.parent, [...(children.get(session.parent) ?? []), session]);
  const kept = new Set(mains.slice(0, SESSION_LIST_LIMIT).map((session) => session.id));
  const include = (id: string) => {
    for (const child of children.get(id) ?? [])
      if (!kept.has(child.id)) {
        kept.add(child.id);
        include(child.id);
      }
  };
  for (const id of [...kept]) include(id);
  return list.filter((session) => kept.has(session.id)).sort(newestFirst);
}

/** The agent's own past sessions in `cwd`, newest first; empty when it cannot list them. */
export function acpSessions(
  id: AgentBackendId,
  cwd: string,
  decorate?: SessionDecorator,
): Promise<AgentSessionInfo[]> {
  return withAgent(id, cwd, async (connection, init) => {
    if (!init.agentCapabilities?.sessionCapabilities?.list) return [];
    const answer = (await connection.request("session/list", { cwd })) as {
      sessions?: RawSession[];
    };
    const list = (answer.sessions ?? []).flatMap((session): AgentSessionInfo[] => {
      const title = session.title?.trim();
      // A session that never received a prompt has no title (or a placeholder like OpenCode's).
      if (!session.sessionId || !title || EMPTY_TITLE.test(title)) return [];
      const parent = parentOf(session);
      // Only a branch is named by its agent: the same field on a chat is the mode it runs in.
      const agent = parent ? agentOf(session) : undefined;
      return [
        {
          id: session.sessionId,
          title,
          ...(session.updatedAt ? { updatedAt: session.updatedAt } : {}),
          ...(parent ? { parent } : {}),
          ...(agent ? { agent } : {}),
        },
      ];
    });
    return capSessions(decorate ? await decorate(list) : list);
  });
}

/** Removes a past session through `session/delete`, for agents that offer it. */
export function acpDeleteSession(
  id: AgentBackendId,
  cwd: string,
  sessionId: string,
): Promise<void> {
  return withAgent(id, cwd, async (connection, init) => {
    if (!init.agentCapabilities?.sessionCapabilities?.delete)
      throw new Error("Агент не умеет удалять сессии");
    await connection.request("session/delete", { sessionId });
  });
}

/** The messages of a past session, replayed by the agent through `session/load`. */
export function acpLoadSession(
  id: AgentBackendId,
  cwd: string,
  sessionId: string,
): Promise<AgentSessionTurn[]> {
  const collector = createAcpReplayCollector(id, sessionId, acpProgram(id).dialect?.());
  return withAgent(
    id,
    cwd,
    async (connection, init) => {
      if (!init.agentCapabilities?.loadSession)
        throw new Error("Агент не умеет восстанавливать прошлые сессии");
      await connection.request("session/load", { sessionId, cwd, mcpServers: [] });
      return collector.turns;
    },
    (update) => collector.handleUpdate(update),
  );
}
