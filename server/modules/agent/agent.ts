import type { AgentBackend, AgentRunOptions } from "./backend.ts";
import { createAcpBackend } from "./acp-backend.ts";
import { claudeCodeBackend } from "./claude-code-backend.ts";
import { projectorBackend } from "./projector-backend.ts";

export type { AgentEmitter, AgentEventName, AgentRunOptions } from "./backend.ts";
export { AGENT_BACKEND_IDS, AGENT_PERMISSION_MODES } from "./backend.ts";
export type { AgentBackendId, AgentPermissionMode } from "./backend.ts";

const backends: AgentBackend[] = [
  projectorBackend,
  claudeCodeBackend,
  createAcpBackend("opencode"),
  createAcpBackend("cursor"),
  createAcpBackend("codex"),
];

export async function runAgent(options: AgentRunOptions): Promise<void> {
  const id = options.backend ?? "projector";
  const backend = backends.find((item) => item.id === id);
  if (!backend) throw new Error(`Неизвестный агент: ${id}`);
  await backend.run(options);
}
