import type { AgentBackend, AgentBackendId, AgentRunOptions } from "./backend.ts";

export type { AgentEmitter, AgentEventName, AgentRunOptions } from "./backend.ts";
export type {
  AgentBackend,
  AgentBackendId,
  AgentCommand,
  AgentPermissionMode,
  McpServerInfo,
  MessagePart,
  RewindResult,
} from "./backend.ts";
export type {
  AgentControl,
  AgentSelection,
  AgentSessionInfo,
  AgentSessionTurn,
} from "./controls.ts";
export { selectionFrom } from "./controls.ts";

const backends = new Map<AgentBackendId, AgentBackend>();
let defaultId: AgentBackendId | undefined;

/**
 * Adds an agent to the chat under the id it declares; registering the same id again replaces it.
 * The first backend registered with `asDefault` answers the requests that name no agent.
 */
export function registerAgentBackend(backend: AgentBackend, options: { asDefault?: boolean } = {}) {
  backends.set(backend.id, backend);
  if (options.asDefault || defaultId === undefined) defaultId = backend.id;
}

/** Whether a request names an agent this server has registered. */
export function isAgentBackend(id: unknown): id is AgentBackendId {
  return typeof id === "string" && backends.has(id);
}

/** The agent a request runs with: the one it names, else the default. */
export function resolveAgentBackend(id: unknown): AgentBackendId {
  if (isAgentBackend(id)) return id;
  if (defaultId === undefined) throw new Error("Ни один агент не зарегистрирован");
  return defaultId;
}

function backendFor(id: AgentBackendId | undefined): AgentBackend {
  const backend = backends.get(id ?? defaultId ?? "");
  if (!backend) throw new Error(`Неизвестный агент: ${id}`);
  return backend;
}

/** Whether the agent's run lives in its own host process, so it survives a server restart. */
export function isHostedAgent(id: AgentBackendId | undefined): boolean {
  return backendFor(id).capabilities?.hosted === true;
}

/** Method-backed operations are derived from the adapter, never its name. */
export function agentCapabilities(id: string | undefined) {
  const backend = backendFor(id);
  return {
    ...backend.capabilities,
    rewindFiles: !!backend.rewindFiles,
    editSessions: !!backend.updateSession,
  };
}

/** Model, effort and mode choices the agent offers; empty for agents without any. */
export async function agentControls(id: string | undefined, cwd: string) {
  return (await backendFor(id).controls?.(cwd)) ?? [];
}

export async function agentCommands(id: string | undefined, cwd: string) {
  return (await backendFor(id).commands?.(cwd)) ?? [];
}

export async function rewindAgentFiles(
  id: string | undefined,
  cwd: string,
  sessionId: string,
  messageId: string,
  dryRun: boolean,
) {
  const backend = backendFor(id);
  if (!backend.rewindFiles) throw new Error("Этот агент не умеет возвращать файлы к прошлому шагу");
  return backend.rewindFiles(cwd, sessionId, messageId, dryRun);
}

export async function updateAgentSession(
  id: string | undefined,
  cwd: string,
  sessionId: string,
  change: { title?: string; pinned?: boolean },
) {
  const backend = backendFor(id);
  if (!backend.updateSession) throw new Error("Этот агент не умеет переименовывать сессии");
  await backend.updateSession(cwd, sessionId, change);
}

export async function agentMcpServers(id: string | undefined, cwd: string) {
  return (await backendFor(id).mcpServers?.(cwd)) ?? [];
}

export async function agentSessions(id: string | undefined, cwd: string) {
  return (await backendFor(id).sessions?.(cwd)) ?? [];
}

export async function loadAgentSession(id: string | undefined, cwd: string, sessionId: string) {
  const backend = backendFor(id);
  if (!backend.loadSession) throw new Error("Агент не умеет восстанавливать прошлые сессии");
  return backend.loadSession(cwd, sessionId);
}

export async function runAgent(options: AgentRunOptions): Promise<void> {
  await backendFor(options.backend).run(options);
}
