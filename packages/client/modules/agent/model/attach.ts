import { fetchRecentChats } from "../api/chats.ts";
import { chatTabCommand } from "../lib/chat-tab.ts";
import { chatsOf, waitForChat, type ChatController } from "./chat-registry.ts";
import type { FileRange, MessageChip } from "./types.ts";

export interface AttachChatOptions {
  /** A chat from `ide.agent.chats.list`; without it, the chat in use gets the chips. */
  chat?: string;
  /** Runs an IDE command in the workspace scope, for opening a chat when none is open. */
  run: (id: string, args?: unknown) => Promise<unknown>;
  /** Open a chat when none is open; defaults to true. */
  open?: boolean;
}

/** Adds a line range as a file chip, for the editor's "add to chat" action. */
export function attachRangeToChat(
  projectId: string,
  path: string,
  range: FileRange,
  chat: string | undefined,
  run: AttachChatOptions["run"],
) {
  return attachChipsToChat(projectId, [{ type: "file", path, range }], { chat, run });
}

/**
 * Puts chips into a chat's draft: the open chat in use, or the most recent saved chat when no
 * chat is open. The chat is not sent: the user sees the chips and writes the message.
 */
export async function attachChipsToChat(
  projectId: string,
  chips: MessageChip[],
  options: AttachChatOptions,
): Promise<ChatController> {
  const open = chatsOf(projectId);
  if (options.chat) {
    const named = open.find((chat) => chat.key === options.chat);
    if (!named)
      throw new Error(`Чат «${options.chat}» не открыт; открытые даёт ide.agent.chats.list`);
    await named.attach(chips);
    return named;
  }
  if (open.length) {
    await open[0]!.attach(chips);
    return open[0]!;
  }
  if (options.open === false) throw new Error("Нет открытого чата агента");

  const recent = await fetchRecentChats(projectId).catch(() => []);
  for (const item of recent) {
    const tab = chatTabCommand(projectId, item.chat, item.title);
    if (!tab) continue;
    await options.run(tab.command, tab.args);
    const chat = await waitForChat(projectId, item.chat);
    await chat.attach(chips);
    return chat;
  }

  await options.run("ide.workbench.agent.open");
  const chat = await waitForChat(projectId);
  await chat.attach(chips);
  return chat;
}
