import type { AgentBackendId } from "./types.ts";

/**
 * The key a chat's history is saved under: one per chat tab. The project's original conversation
 * has no chat id and is saved under the project id itself (`useAgent`).
 */
export function chatKeyOf(backend: AgentBackendId, projectId: string, chatId: string): string {
  return `${backend}:${projectId}:${chatId}`;
}
