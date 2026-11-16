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
 * The contracts an open chat publishes to the rest of the IDE, split by capability: a group of
 * commands names only the operations it uses, and a new capability extends its own group instead
 * of the one interface every chat command depends on.
 */

/** Which chat it is, and what it shows right now: every group starts here. */
export interface ChatRef {
  key: string;
  projectId: string;
  backend: AgentBackendId;
  label: string;
  busy(): boolean;
  needsUser?(): boolean;
  /** The chat is on screen: its tab is the shown one. */
  visible(): boolean;
  turns(): AgentTurn[];
  /** Subagents and background commands of the chat. */
  tasks(): AgentTask[];
  capabilities(): AgentCapabilities;
}

/** The model, effort and mode choices the composer shows. */
export interface ChatControls {
  controls(): AgentControl[];
  /** The current model, effort and mode choices; Lens uses the provider one. */
  selection(): AgentSelection;
  setControl(id: string, value: string): Promise<void>;
}

/** Sending and reworking the answer: the conversation itself. */
export interface ChatFlow {
  send(text: string): Promise<void>;
  /** Adds a message to the answer being written; `false` when it could not be added. */
  inject(text: string): Promise<boolean>;
  stop(): void;
  edit(turnId: string): void;
  retry(turnId: string): Promise<void>;
  compact(): Promise<void>;
}

/** A new chat from the turns before (or up to) a message; the original is untouched. */
export interface ChatBranch {
  fork(turnId: string, mode?: ForkMode): Promise<{ chat: string }>;
}

/** The saved conversation: its export and the rollback to any moment of it. */
export interface ChatHistory {
  exportMarkdown(): string;
  rewind(turnId: string, scope: RewindScope): Promise<unknown>;
  showVersion(turnId: string, version: number): void;
}

/** Messages that wait for the end of the answer. */
export interface ChatQueue {
  queue(): QueuedMessage[];
  removeQueued(id: string): void;
}

/** The past sessions of the agent behind the chat. */
export interface ChatSessions {
  loadSessions(): Promise<AgentSessionInfo[]>;
  resumeSession(id: string): Promise<void>;
  removeSession(id: string): Promise<void>;
}

/** The draft and the controls above it: chips and text are added without sending. */
export interface ChatComposer {
  attach(chips: MessageChip[]): Promise<void>;
  appendText(text: string): Promise<void>;
  toggleControlsMenu(): void;
}

/** The form the last answer ended with: it takes the place of the text field. */
export interface ChatForms {
  pendingForm(): string | undefined;
  showForm(): void;
  hideForm(): void;
}

/** The side question panel and the read-only snapshot it reads. */
export interface ChatSide {
  /** A read-only snapshot of the chat, for `ide.agent.chat.status`. */
  status(): Promise<AgentChatStatus>;
  /** Opens the side-question panel of this chat. */
  openSide(): void;
  /** Asks a side question and resolves with its answer; it is not added to the chat. */
  askSide(text: string): Promise<string>;
  /** Clears the in-memory side thread of this chat. */
  clearSide(): void;
}

/** Lens: a short caption of what the agent is doing now, shown in the work block. */
export interface ChatLens {
  /** Whether the Lens caption is shown in the work block. */
  lensOpen(): boolean;
  /** Turns Lens on and resolves with the first caption. */
  openLens(): Promise<string>;
  closeLens(): void;
  /** Asks for a new caption; the text is returned as well as shown. */
  refreshLens(): Promise<string>;
  /** Whether Lens asks again by itself while the agent works. */
  setLensAuto(on: boolean): void;
}

/** The MCP servers an external agent runs in the project. */
export interface ChatMcp {
  mcpServers(): Promise<McpServer[]>;
}

/** The isolated copy of the project the chat works in, if any. */
export interface ChatWorktree {
  worktree(): Promise<WorktreeInfo | undefined>;
  mergeWorktree(): Promise<string>;
  discardWorktree(): Promise<void>;
  /** Starts the chat's first message in an isolated copy of the project. */
  setIsolate(on: boolean): void;
}

/**
 * What an open chat lets the rest of the IDE do with it. The chat is a temporary view (a tab that
 * comes and goes), so it only publishes this data; the commands built on it are registered once,
 * at the workspace (`registerAgentCommands`), and survive the chat.
 */
export type ChatController = ChatRef &
  ChatControls &
  ChatFlow &
  ChatBranch &
  ChatHistory &
  ChatQueue &
  ChatSessions &
  ChatComposer &
  ChatForms &
  ChatSide &
  ChatLens &
  ChatMcp &
  ChatWorktree;
