import { forkSession, getSessionMessages, query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { agentEnv } from "./agent-host.ts";
import type { McpServerInfo, RewindResult } from "./backend.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

/** The last entry of the conversation a session holds now: where the next message would attach. */
export async function chainTail(cwd: string, sessionId: string): Promise<string | undefined> {
  try {
    return (await getSessionMessages(sessionId, { dir: cwd })).at(-1)?.uuid;
  } catch {
    return undefined;
  }
}

/**
 * The session to continue for a chat that stands at `tail`. A session can only grow at its end, so
 * when it has moved past `tail` (the user went back and wrote something else) the conversation is
 * branched off at `tail` and the old session stays as it was, ready to be returned to.
 */
export async function sessionAt(
  cwd: string,
  sessionId: string,
  tail: string | undefined,
): Promise<string> {
  if (!tail || !isUuid(tail)) return sessionId;
  try {
    const chain = await getSessionMessages(sessionId, { dir: cwd });
    if (chain.at(-1)?.uuid === tail || !chain.some((message) => message.uuid === tail))
      return sessionId;
    return (await forkSession(sessionId, { dir: cwd, upToMessageId: tail })).sessionId;
  } catch {
    // The transcript is unreadable: the caller's own fallback (a replay from the history) decides.
    return sessionId;
  }
}

/** A session that stays open without a prompt, to ask it things; `close` ends it. */
function idleSession(options: Parameters<typeof query>[0]["options"]) {
  const idle = (async function* (): AsyncGenerator<SDKUserMessage> {
    await new Promise<never>(() => {});
  })();
  return query({ prompt: idle, options });
}

/** Puts the project's files back to how they were before the message `messageId` was sent. */
export async function rewindClaudeFiles(
  cwd: string,
  sessionId: string,
  messageId: string,
  dryRun: boolean,
): Promise<RewindResult> {
  if (!isUuid(messageId) || !isUuid(sessionId)) throw new Error("Некорректный шаг для отката");
  const session = idleSession({
    cwd,
    env: agentEnv(),
    resume: sessionId,
    enableFileCheckpointing: true,
    settingSources: [],
  });
  try {
    const result = await session.rewindFiles(messageId, { dryRun });
    return {
      ok: result.canRewind,
      error: result.error,
      files: result.filesChanged ?? [],
      insertions: result.insertions,
      deletions: result.deletions,
    };
  } finally {
    session.close();
  }
}

const MCP_TTL_MS = 30_000;
const mcpCache = new Map<string, { at: number; servers: Promise<McpServerInfo[]> }>();

/** MCP servers Claude Code would start in the folder (user, project and local settings). */
export function claudeMcpServers(cwd: string): Promise<McpServerInfo[]> {
  const cached = mcpCache.get(cwd);
  if (cached && Date.now() - cached.at < MCP_TTL_MS) return cached.servers;
  const servers = (async () => {
    const session = idleSession({
      cwd,
      env: agentEnv(),
      settingSources: ["user", "project", "local"],
    });
    try {
      // Servers connect in the background: give the slow ones a moment before reporting.
      await session.initializationResult();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return (await session.mcpServerStatus()).map((server) => ({
        name: server.name,
        status: server.status,
        tools: server.tools?.length ?? 0,
        error: server.error,
      }));
    } finally {
      session.close();
    }
  })();
  mcpCache.set(cwd, { at: Date.now(), servers });
  servers.catch(() => mcpCache.delete(cwd));
  return servers;
}
