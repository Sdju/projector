import { nextTick, shallowReactive } from "vue";
import type { McpServer, WorktreeInfo } from "../api/client.ts";
import type { ForkMode } from "./branches.ts";
import type {
  AgentBackendId,
  AgentCapabilities,
  AgentChatStatus,
  AgentControl,
  AgentSelection,
  AgentSessionInfo,
  AgentTask,
  AgentTurn,
  MessageChip,
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
  /** Subagents and background commands of the chat. */
  tasks(): AgentTask[];
  queue(): QueuedMessage[];
  controls(): AgentControl[];
  /** The current model, effort and mode choices; Lens uses the provider one. */
  selection(): AgentSelection;
  capabilities(): AgentCapabilities;
  setControl(id: string, value: string): Promise<void>;
  loadSessions(): Promise<AgentSessionInfo[]>;
  resumeSession(id: string): Promise<void>;
  removeSession(id: string): Promise<void>;
  toggleControlsMenu(): void;
  send(text: string): Promise<void>;
  /** Adds chips to the end of the draft without sending; a form gives way to the text field. */
  attach(chips: MessageChip[]): Promise<void>;
  /** Appends plain text to the draft without sending; a form gives way to the text field. */
  appendText(text: string): Promise<void>;
  /** The block the last answer ended with, if the chat waits for it: a form instead of the field. */
  pendingForm(): string | undefined;
  /** Shows that form in the composer again. */
  showForm(): void;
  /** Hides the form and returns the ordinary text field. */
  hideForm(): void;
  /** Adds a message to the answer being written; `false` when it could not be added. */
  inject(text: string): Promise<boolean>;
  stop(): void;
  edit(turnId: string): void;
  retry(turnId: string): Promise<void>;
  /** Starts a new chat from the turns before (or up to) a message; the original is untouched. */
  fork(turnId: string, mode?: ForkMode): Promise<{ chat: string }>;
  rewind(turnId: string, scope: RewindScope): Promise<unknown>;
  showVersion(turnId: string, version: number): void;
  removeQueued(id: string): void;
  exportMarkdown(): string;
  compact(): Promise<void>;
  /** A read-only snapshot of the chat, for `ide.agent.chat.status`. */
  status(): Promise<AgentChatStatus>;
  /** Opens the side-question panel of this chat. */
  openSide(): void;
  /** Asks a side question and resolves with its answer; it is not added to the chat. */
  askSide(text: string): Promise<string>;
  /** Clears the in-memory side thread of this chat. */
  clearSide(): void;
  /** Whether the Lens caption is shown in the work block. */
  lensOpen(): boolean;
  /** Turns Lens on and resolves with the first caption. */
  openLens(): Promise<string>;
  closeLens(): void;
  /** Asks for a new caption; the text is returned as well as shown. */
  refreshLens(): Promise<string>;
  /** Whether Lens asks again by itself while the agent works. */
  setLensAuto(on: boolean): void;
  mcpServers(): Promise<McpServer[]>;
  /** The isolated copy of the project the chat works in, if any. */
  worktree(): Promise<WorktreeInfo | undefined>;
  mergeWorktree(): Promise<string>;
  discardWorktree(): Promise<void>;
  /** Starts the chat's first message in an isolated copy of the project. */
  setIsolate(on: boolean): void;
}

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
export function openChats(): ChatController[] {
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
