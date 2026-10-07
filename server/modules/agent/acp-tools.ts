import type { AcpConnection } from "./acp-client.ts";
import { controlsFromSession } from "./acp-controls.ts";
import { createAcpReplayCollector } from "./acp-events.ts";
import { initializeAcp, startAcp, type AcpInitResult } from "./acp-process.ts";
import type { AgentBackendId } from "./backend.ts";
import {
  SESSION_LIST_LIMIT,
  type AgentControl,
  type AgentSessionInfo,
  type AgentSessionTurn,
} from "./controls.ts";

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
    return await work(connection, await initializeAcp(connection));
  } finally {
    await connection.close();
  }
}

/** Drops the throwaway session so probing does not fill the agent's own history. */
async function discard(connection: AcpConnection, init: AcpInitResult, sessionId: string) {
  const capabilities = init.agentCapabilities?.sessionCapabilities ?? {};
  const method = capabilities.delete
    ? "session/delete"
    : capabilities.close
      ? "session/close"
      : undefined;
  if (method) await connection.request(method, { sessionId }, 10_000).catch(() => {});
}

/** Models, effort levels and modes the agent offers in `cwd`, cached for a few minutes. */
export function acpControls(id: AgentBackendId, cwd: string): Promise<AgentControl[]> {
  const key = `${id}\n${cwd}`;
  const cached = controlsCache.get(key);
  if (cached && Date.now() - cached.at < CONTROLS_TTL_MS) return cached.controls;
  const controls = withAgent(id, cwd, async (connection, init) => {
    const created = (await connection.request("session/new", { cwd, mcpServers: [] })) as {
      sessionId: string;
    };
    await discard(connection, init, created.sessionId);
    return controlsFromSession(created);
  });
  controlsCache.set(key, { at: Date.now(), controls });
  // A failure must not stick for the whole TTL.
  controls.catch(() => controlsCache.delete(key));
  return controls;
}

const EMPTY_TITLE = /^New session - \d{4}-\d\d-\d\dT/;

interface RawSession {
  sessionId?: string;
  title?: string | null;
  updatedAt?: string | null;
}

/** The agent's own past sessions in `cwd`, newest first; empty when it cannot list them. */
export function acpSessions(id: AgentBackendId, cwd: string): Promise<AgentSessionInfo[]> {
  return withAgent(id, cwd, async (connection, init) => {
    if (!init.agentCapabilities?.sessionCapabilities?.list) return [];
    const answer = (await connection.request("session/list", { cwd })) as {
      sessions?: RawSession[];
    };
    return (answer.sessions ?? [])
      .flatMap((session): AgentSessionInfo[] => {
        const title = session.title?.trim();
        // An untitled session never received a prompt (OpenCode names it by its creation time).
        if (!session.sessionId || !title || EMPTY_TITLE.test(title)) return [];
        return [
          {
            id: session.sessionId,
            title,
            ...(session.updatedAt ? { updatedAt: session.updatedAt } : {}),
          },
        ];
      })
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
      .slice(0, SESSION_LIST_LIMIT);
  });
}

/** The messages of a past session, replayed by the agent through `session/load`. */
export function acpLoadSession(
  id: AgentBackendId,
  cwd: string,
  sessionId: string,
): Promise<AgentSessionTurn[]> {
  const collector = createAcpReplayCollector(id, sessionId);
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
