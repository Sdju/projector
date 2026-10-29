/** The permission policy of the chat; each backend defines its own values. */
export type AgentPermissionMode = string;

/** Operations and context policy published by the running backend adapter. */
export interface AgentCapabilities {
  /** The run is held by its own host process, so a server restart or hot reload does not stop it. */
  hosted?: boolean;
  inject?: boolean;
  branchSession?: boolean;
  rewindFiles?: boolean;
  editSessions?: boolean;
  deleteSessions?: boolean;
  compact?: { command: string; hintAt: number; autoAt: number };
}

import type { AgentHistoryTurn } from "../providers/index.ts";
import type {
  AgentControl,
  AgentSelection,
  AgentSessionInfo,
  AgentSessionTurn,
} from "./controls.ts";
import type {
  ApprovalAnswer,
  ApprovalRequest,
  CommandRequest,
  QuestionAnswer,
  QuestionRequest,
  SecretRequest,
} from "./command-bridge.ts";

export type AgentEventName =
  | "checkpoint"
  | "command-request"
  | "context"
  | "usage"
  | "commands"
  | "controls"
  | "permission-request"
  | "question-request"
  | "secret-request"
  | "run"
  | "worktree"
  | "status"
  | "session"
  | "input"
  | "text"
  | "tool"
  | "tool-result"
  | "task"
  | "thought"
  | "project"
  | "done"
  | "error";

export type AgentEmitter = (event: AgentEventName, data: unknown) => void;

/** Which agent serves the chat: the id a backend registered with (see `registry.ts`). */
export type AgentBackendId = string;

/** A run whose agent process lives outside the server, so a server restart can rejoin it. */
export interface AgentRunHandle {
  id: string;
  /** Replay the run an earlier server started instead of starting the agent. */
  attach: boolean;
}

/** A message as the user wrote it: text with project files, images and commands between it. */
export type MessagePart =
  | { type: "text"; text: string }
  | { type: "file"; path: string; directory?: boolean }
  | { type: "image"; id: string; name: string; mime: string }
  | { type: "command"; name: string };

/** A slash command of an agent: `/name`, typed at the start of a message. */
export interface AgentCommand {
  name: string;
  description?: string;
  hint?: string;
}

export interface AgentRunOptions {
  run?: AgentRunHandle;
  /** Defaults to `projector`. */
  backend?: AgentBackendId;
  permissionMode?: AgentPermissionMode;
  /** Model, effort and mode chosen in the chat, by control id. */
  selection?: AgentSelection;
  message: string;
  /** `message` with its chips; the text already names every file (`@path`). */
  parts?: MessagePart[];
  cwd?: string;
  commands?: (request: CommandRequest) => Promise<unknown>;
  /** Asks the user before a sensitive tool runs; absent when the client cannot show a prompt. */
  approve?: (request: ApprovalRequest) => Promise<ApprovalAnswer>;
  /** Puts a question to the user; absent when the client cannot show one. */
  ask?: (request: QuestionRequest) => Promise<QuestionAnswer>;
  /** Asks the user for a secret to store directly; absent when the client cannot show one. */
  secret?: (request: SecretRequest) => Promise<string | null>;
  history?: AgentHistoryTurn[];
  /** Native conversation of the backend (Claude Code session ID) to continue instead of `history`. */
  sessionId?: string;
  /** The message's own ID (a UUID): the transcript keeps it, so files can be rewound to it later. */
  messageId?: string;
  /**
   * Where in `sessionId` the conversation stands: the transcript position after the last answer
   * the user keeps. A session that has moved past it is branched from there, not continued.
   */
  tail?: string;
  providerId?: string;
  abort?: AbortSignal;
  emit: AgentEmitter;
}

/**
 * One way of running the chat agent. A backend streams the shared SSE events (`text`, `tool`,
 * `tool-result`, ...) so the client stays agent-agnostic. To add an agent, extend `AgentBackendId`,
 * implement a backend in its own module under `server/modules/agents/` and register it in
 * `server/app/agents.ts`.
 */
export interface AgentBackend {
  id: AgentBackendId;
  capabilities?: AgentCapabilities;
  run(options: AgentRunOptions): Promise<void>;
  /** The program the agent needs is installed; absent when the backend cannot tell beforehand. */
  available?(): boolean;
  /** What the user may tune before a turn (model, effort, mode). */
  controls?(cwd: string): Promise<AgentControl[]>;
  /** Slash commands the agent understands in this project, when it can tell before a turn. */
  commands?(cwd: string): Promise<AgentCommand[]>;
  /** Past conversations of this agent in the project, newest first. */
  sessions?(cwd: string): Promise<AgentSessionInfo[]>;
  /** The messages of one past conversation, to continue it in the chat. */
  loadSession?(cwd: string, sessionId: string): Promise<AgentSessionTurn[]>;
  /** Renames a past conversation or pins it to the top of the list. */
  updateSession?(
    cwd: string,
    sessionId: string,
    change: { title?: string; pinned?: boolean },
  ): Promise<void>;
  /** Removes a past conversation for good. */
  deleteSession?(cwd: string, sessionId: string): Promise<void>;
  /** Puts the project's files back to how they were before a message; `dryRun` only reports. */
  rewindFiles?(
    cwd: string,
    sessionId: string,
    messageId: string,
    dryRun: boolean,
  ): Promise<RewindResult>;
  /** Servers, tools and limits the agent runs with in the project, for the chat to show. */
  mcpServers?(cwd: string): Promise<McpServerInfo[]>;
}

/** What rewinding files changed (or, for a dry run, would change). */
export interface RewindResult {
  ok: boolean;
  error?: string;
  files: string[];
  insertions?: number;
  deletions?: number;
}

export interface McpServerInfo {
  name: string;
  status: string;
  tools: number;
  error?: string;
}
