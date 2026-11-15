import { nextTick, shallowReactive } from "vue";
import type { ChatController, ChatRef } from "./chat-contracts.ts";

// Shallow-reactive so a tab that follows a chat finds it when the chat opens later.
const chats = shallowReactive(new Map<string, ChatController>());
/** The chat the user touched last, per project. */
const active = new Map<string, string>();

export function registerChat(chat: ChatController): () => void {
  chats.set(chat.key, chat);
  if (!active.has(chat.projectId)) active.set(chat.projectId, chat.key);
  return () => {
    if (chats.get(chat.key) === chat) chats.delete(chat.key);
    if (active.get(chat.projectId) === chat.key) active.delete(chat.projectId);
  };
}

/** Marks a chat as the one commands without a `chat` argument act on. */
export function activateChat(chat: ChatController): void {
  if (chats.get(chat.key) === chat) active.set(chat.projectId, chat.key);
}

/** The open chats of a project: the ones on screen first, and among them the one used last. */
export function chatsOf(projectId: string): ChatController[] {
  const open = [...chats.values()].filter((chat) => chat.projectId === projectId);
  const last = active.get(projectId);
  const rank = (chat: ChatController) => Number(chat.visible()) * 2 + Number(chat.key === last);
  return open.sort((a, b) => rank(b) - rank(a));
}

/** The chat a command is meant for: the one named by `chat`, or the one in use. */
export function resolveChat(
  projectId: string,
  key?: unknown,
  accept: (chat: ChatController) => boolean = () => true,
): ChatController {
  const open = chatsOf(projectId).filter(accept);
  if (typeof key === "string" && key) {
    const named = open.find((chat) => chat.key === key);
    if (!named) throw new Error(`Чат «${key}» не открыт; открытые даёт ide.agent.chats.list`);
    return named;
  }
  const chat = open[0];
  if (!chat) throw new Error("Нет открытого чата агента");
  return chat;
}

/** All open chats of every project, for the overview of what works now. */
export function openChats(): ChatRef[] {
  return [...chats.values()];
}

/**
 * Waits until a chat tab has registered its controller and has been mounted, so its composer can
 * take chips. Used right after a command opens a chat.
 */
export async function waitForChat(
  projectId: string,
  key?: string,
  timeout = 3000,
): Promise<ChatController> {
  const find = () => chatsOf(projectId).find((chat) => !key || chat.key === key);
  const started = Date.now();
  for (;;) {
    const chat = find();
    if (chat) {
      await nextTick();
      return chat;
    }
    if (Date.now() - started > timeout) throw new Error("Чат не открылся");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
