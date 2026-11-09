import { fetchRecentChats } from "../../agent-core/index.ts";
import { chatTabCommand } from "../../agent-core/index.ts";
import { chatsOf, waitForChat, type ChatController } from "../../agent-core/index.ts";
import type { FileRange, MessageChip } from "../../agent-core/index.ts";

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
export function attachChipsToChat(
  projectId: string,
  chips: MessageChip[],
  options: AttachChatOptions,
): Promise<ChatController> {
  return withChat(projectId, options, (chat) => chat.attach(chips));
}

export interface AttachTextOptions extends AttachChatOptions {
  /** What the text is, shown before it in the draft: a file, a terminal. */
  source?: string;
}

/**
 * Puts selected text into a chat's draft, for surfaces without file lines (the visual Markdown
 * editor, a terminal). The message is not sent: the user sees the text and writes the message.
 */
export async function attachTextToChat(
  projectId: string,
  text: string,
  options: AttachTextOptions,
): Promise<ChatController> {
  const body = text.trim();
  if (!body) throw new Error("Выделите текст");
  const source = options.source?.trim();
  return withChat(projectId, options, (chat) =>
    chat.appendText(source ? `${source}:\n${body}` : body),
  );
}

/** Runs `apply` on the chat that takes context: the one in use, else the newest saved one. */
async function withChat(
  projectId: string,
  options: AttachChatOptions,
  apply: (chat: ChatController) => Promise<void>,
): Promise<ChatController> {
  const open = chatsOf(projectId);
  if (options.chat) {
    const named = open.find((chat) => chat.key === options.chat);
    if (!named)
      throw new Error(`Чат «${options.chat}» не открыт; открытые даёт ide.agent.chats.list`);
    await apply(named);
    return named;
  }
  if (open.length) {
    await apply(open[0]!);
    return open[0]!;
  }
  if (options.open === false) throw new Error("Нет открытого чата агента");

  const recent = await fetchRecentChats(projectId).catch(() => []);
  for (const item of recent) {
    const tab = chatTabCommand(projectId, item.chat, item.title);
    if (!tab) continue;
    await options.run(tab.command, tab.args);
    const chat = await waitForChat(projectId, item.chat);
    await apply(chat);
    return chat;
  }

  await options.run("ide.workbench.agent.open");
  const chat = await waitForChat(projectId);
  await apply(chat);
  return chat;
}
