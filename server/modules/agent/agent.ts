import type { AgentBackend, AgentRunOptions } from "./backend.ts";
import { createAcpBackend } from "./acp-backend.ts";
import { claudeCodeBackend } from "./claude-code-backend.ts";
import { projectorBackend } from "./projector-backend.ts";

export type { AgentEmitter, AgentEventName, AgentRunOptions } from "./backend.ts";
export { AGENT_BACKEND_IDS, AGENT_PERMISSION_MODES } from "./backend.ts";
export type { AgentBackendId, AgentPermissionMode } from "./backend.ts";
export type {
  AgentControl,
  AgentSelection,
  AgentSessionInfo,
  AgentSessionTurn,
} from "./controls.ts";
export { selectionFrom } from "./controls.ts";

const backends: AgentBackend[] = [
  projectorBackend,
  claudeCodeBackend,
  createAcpBackend("opencode"),
  createAcpBackend("cursor"),
  createAcpBackend("codex"),
];

function backendFor(id: string | undefined): AgentBackend {
  const backend = backends.find((item) => item.id === (id ?? "projector"));
  if (!backend) throw new Error(`Неизвестный агент: ${id}`);
  return backend;
}

/** Model, effort and mode choices the agent offers; empty for agents without any. */
export async function agentControls(id: string | undefined, cwd: string) {
  return (await backendFor(id).controls?.(cwd)) ?? [];
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
  const id = options.backend ?? "projector";
  const backend = backends.find((item) => item.id === id);
  if (!backend) throw new Error(`Неизвестный агент: ${id}`);
  await backend.run(options);
}
