import type { AgentHistoryTurn } from "../providers/index.ts";
import type { ApprovalAnswer, ApprovalRequest, CommandRequest } from "./command-bridge.ts";

export type AgentEventName =
  | "command-request"
  | "permission-request"
  | "status"
  | "session"
  | "text"
  | "tool"
  | "tool-result"
  | "project"
  | "done"
  | "error";

export type AgentEmitter = (event: AgentEventName, data: unknown) => void;

/** Which agent serves the chat: the Projector IDE assistant or a plain external coding agent. */
export type AgentBackendId = "projector" | "claude-code" | "codex" | "opencode" | "cursor";

export const AGENT_BACKEND_IDS: readonly AgentBackendId[] = [
  "projector",
  "claude-code",
  "codex",
  "opencode",
  "cursor",
];

/** Claude Code permission policy: `default` asks in the chat before edits and shell commands. */
export type AgentPermissionMode = "default" | "acceptEdits" | "bypassPermissions";

export const AGENT_PERMISSION_MODES: readonly AgentPermissionMode[] = [
  "default",
  "acceptEdits",
  "bypassPermissions",
];

export interface AgentRunOptions {
  /** Defaults to `projector`. */
  backend?: AgentBackendId;
  permissionMode?: AgentPermissionMode;
  message: string;
  cwd?: string;
  commands?: (request: CommandRequest) => Promise<unknown>;
  /** Asks the user before a sensitive tool runs; absent when the client cannot show a prompt. */
  approve?: (request: ApprovalRequest) => Promise<ApprovalAnswer>;
  history?: AgentHistoryTurn[];
  /** Native conversation of the backend (Claude Code session ID) to continue instead of `history`. */
  sessionId?: string;
  providerId?: string;
  abort?: AbortSignal;
  emit: AgentEmitter;
}

/**
 * One way of running the chat agent. A backend streams the shared SSE events (`text`, `tool`,
 * `tool-result`, ...) so the client stays agent-agnostic. To add an agent, extend `AgentBackendId`,
 * implement a backend and register it in `agent.ts`.
 */
export interface AgentBackend {
  id: AgentBackendId;
  run(options: AgentRunOptions): Promise<void>;
}
