import { clientAgents } from "../../agents-integration/catalog/index.ts";

/** The command and arguments that show the tab of the chat with this key, if the chat has one. */
export function chatTabCommand(
  projectId: string,
  chat: string,
  title?: string,
): { command: string; args: { chatId: string; title?: string } } | undefined {
  for (const agent of clientAgents()) {
    const tab = agent.builtin ? "agent" : agent.program;
    const prefix = `${agent.backend}:${projectId}:`;
    if (chat.startsWith(prefix) && chat.length > prefix.length)
      return {
        command: `ide.workbench.${tab}.open`,
        args: { chatId: chat.slice(prefix.length), ...(title ? { title } : {}) },
      };
  }
  // The project's own conversation (key = project) is the tab without a chat id.
  return undefined;
}
