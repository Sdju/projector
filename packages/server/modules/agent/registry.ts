import type { AgentUsageWindowDefinition } from "@ai-projector/core/modules/usage-analytics/index.ts";
import type {
  AgentBackend,
  AgentBackendId,
  AgentCapabilities,
  AgentRunOptions,
  AgentTerminal,
} from "./backend.ts";
import { preferences } from "../preferences/index.ts";
import { removeChatsWithSession } from "./recent-chats.ts";

export type { AgentEmitter, AgentEventName, AgentRunOptions } from "./backend.ts";
export type {
  AgentBackend,
  AgentBackendId,
  AgentCommand,
  AgentPermissionMode,
  AgentTerminal,
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
// Bumped by every successful catalog change, so readers can notice that the set of agents moved.
let revision = 0;

/**
 * Adds an agent to the chat under the id it declares; registering the same id again replaces it.
 * The first backend registered with `asDefault` answers the requests that name no agent.
 */
export function registerAgentBackend(backend: AgentBackend, options: { asDefault?: boolean } = {}) {
  backends.set(backend.id, backend);
  if (options.asDefault || defaultId === undefined) defaultId = backend.id;
  revision++;
}

/**
 * Removes an agent from the chat. The default backend and the server's own built-ins stay: a chat
 * that names one of them must never lose its agent without the user asking for it.
 */
export function unregisterAgentBackend(id: AgentBackendId): void {
  const backend = backends.get(id);
  if (!backend) throw new Error(`Неизвестный агент: ${id}`);
  if (id === defaultId) throw new Error(`Агент по умолчанию нельзя удалить: ${id}`);
  if (backend.builtin) throw new Error(`Встроенного агента нельзя удалить: ${id}`);
  backends.delete(id);
  revision++;
}

/** The catalog revision: it grows on every registration, replacement and removal. */
export function agentCatalogRevision(): number {
  return revision;
}

/** A registered backend as the settings, the routes and the client see it. */
export interface AgentBackendSummary {
  id: AgentBackendId;
  label: string;
  caption?: string;
  icon?: string;
  program?: string;
  terminal?: AgentTerminal;
  builtin?: boolean;
  capabilities?: AgentCapabilities;
  usageUrl?: string;
  usageWindows?: readonly AgentUsageWindowDefinition[];
}

/** Every registered backend in registration order, without its methods. */
export function listAgentBackends(): AgentBackendSummary[] {
  return [...backends.values()].map(
    ({
      id,
      label,
      caption,
      icon,
      program,
      terminal,
      builtin,
      capabilities,
      usageUrl,
      usageWindows,
    }) => ({
      id,
      label,
      ...(caption ? { caption } : {}),
      ...(icon ? { icon } : {}),
      ...(program ? { program } : {}),
      ...(terminal ? { terminal } : {}),
      ...(builtin ? { builtin } : {}),
      ...(capabilities ? { capabilities } : {}),
      ...(usageUrl ? { usageUrl } : {}),
      ...(usageWindows?.length ? { usageWindows } : {}),
    }),
  );
}

/** Whether a request names an agent this server has registered. */
export function isAgentBackend(id: unknown): id is AgentBackendId {
  return typeof id === "string" && backends.has(id);
}

/**
 * The agent a request runs with: the one it names, else the default. A named agent that is not
 * registered is an error, never the default: an old chat must not silently run another agent.
 */
export function resolveAgentBackend(id: unknown): AgentBackendId {
  if (id === undefined || id === null || id === "") return defaultAgent();
  if (typeof id !== "string")
    throw new Error(`Идентификатор агента должен быть строкой, получено: ${typeof id}`);
  if (backends.has(id)) return id;
  throw new Error(`Неизвестный агент: ${id}`);
}

function defaultAgent(): AgentBackendId {
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

/** Whether the agent can start here: its program is installed (unknown counts as yes). */
export function isAgentAvailable(id: AgentBackendId | undefined): boolean {
  return backendFor(id).available?.() !== false;
}

/** Method-backed operations are derived from the adapter, never its name. */
export function agentCapabilities(id: string | undefined) {
  const backend = backendFor(id);
  return {
    ...backend.capabilities,
    rewindFiles: !!backend.rewindFiles,
    editSessions: !!backend.updateSession,
    deleteSessions: backend.capabilities?.deleteSessions ?? !!backend.deleteSession,
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

export async function deleteAgentSession(
  id: string | undefined,
  cwd: string,
  sessionId: string,
  history?: { project: string; keep?: string },
) {
  const backend = backendFor(id);
  if (!backend.deleteSession) throw new Error("Этот агент не умеет удалять сессии");
  await backend.deleteSession(cwd, sessionId);
  // The chats that continued the session are the same conversation: remove their copies too.
  if (history?.project)
    removeChatsWithSession(history.project, backend.id, sessionId, history.keep);
}

/** The plugin's limits provider, when it declared one; an unknown or removed agent has none. */
export function agentUsageProvider(id: AgentBackendId | undefined) {
  return backends.get(id ?? defaultId ?? "")?.usage;
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
  // Backends the user switched off in the settings refuse new runs, from chats and jobs alike.
  const backend = backendFor(options.backend);
  if ((await preferences()).disabledAgents.includes(backend.id))
    throw new Error("Этот агент отключён в настройках Projector");
  await backend.run(options);
}
