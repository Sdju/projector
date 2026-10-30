import { jobChatTab } from "./job-labels.ts";

/** The command and arguments that show the tab of the chat with this key, if the chat has one. */
export function chatTabCommand(
  projectId: string,
  chat: string,
  title?: string,
): { command: string; args: { chatId: string; title?: string } } | undefined {
  for (const [backend, tab] of Object.entries({ projector: "agent", ...jobChatTab })) {
    const prefix = `${backend}:${projectId}:`;
    if (chat.startsWith(prefix) && chat.length > prefix.length)
      return {
        command: `ide.workbench.${tab}.open`,
        args: { chatId: chat.slice(prefix.length), ...(title ? { title } : {}) },
      };
  }
  // The project's own conversation (key = project) is the tab without a chat id.
  return undefined;
}
