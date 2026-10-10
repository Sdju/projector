import type { McpServer } from "../api/client.ts";
import type {
  AgentBackendId,
  AgentControl,
  AgentSessionInfo,
  AgentTurn,
  QueuedMessage,
  RewindScope,
} from "./types.ts";

/**
 * What an open chat lets the rest of the IDE do with it. The chat is a temporary view (a tab that
 * comes and goes), so it only publishes this data; the commands built on it are registered once,
 * at the workspace (`registerAgentCommands`), and survive the chat.
 */
export interface ChatController {
  key: string;
  projectId: string;
  backend: AgentBackendId;
  label: string;
  busy(): boolean;
  /** The chat is on screen: its tab is the shown one. */
  visible(): boolean;
  turns(): AgentTurn[];
  queue(): QueuedMessage[];
  controls(): AgentControl[];
  setControl(id: string, value: string): Promise<void>;
  loadSessions(): Promise<AgentSessionInfo[]>;
  resumeSession(id: string): Promise<void>;
  toggleControlsMenu(): void;
  send(text: string): Promise<void>;
  stop(): void;
  edit(turnId: string): void;
  retry(turnId: string): Promise<void>;
  rewind(turnId: string, scope: RewindScope): Promise<unknown>;
  showVersion(turnId: string, version: number): void;
  removeQueued(id: string): void;
  exportMarkdown(): string;
  compact(): Promise<void>;
  mcpServers(): Promise<McpServer[]>;
}

const chats = new Map<string, ChatController>();
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
