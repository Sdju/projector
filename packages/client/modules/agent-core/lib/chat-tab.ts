import { clientAgents } from "../../agents-integration/catalog/index.ts";
import {
  normalizeRoleSnapshot,
  type AgentRoleSnapshot,
} from "@projector-ai/core/modules/agent-role/index.ts";

/** A tab parameter is a string; the snapshot travels as JSON and is parsed by the view. */
export function roleParam(role: AgentRoleSnapshot): string {
  return JSON.stringify(role);
}

export function roleFromParam(value: unknown): AgentRoleSnapshot | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return normalizeRoleSnapshot(JSON.parse(value));
  } catch {
    return undefined;
  }
}

/** The command and arguments that show the tab of the chat with this key, if the chat has one. */
export function chatTabCommand(
  projectId: string,
  chat: string,
  title?: string,
  role?: AgentRoleSnapshot,
): { command: string; args: { chatId: string; title?: string; role?: string } } | undefined {
  for (const agent of clientAgents()) {
    const tab = agent.builtin ? "agent" : agent.program;
    const prefix = `${agent.backend}:${projectId}:`;
    if (chat.startsWith(prefix) && chat.length > prefix.length)
      return {
        command: `ide.workbench.${tab}.open`,
        args: {
          chatId: chat.slice(prefix.length),
          ...(title ? { title } : {}),
          ...(role ? { role: roleParam(role) } : {}),
        },
      };
  }
  // The project's own conversation (key = project) is the tab without a chat id.
  return undefined;
}
