/** Operations and context policy published by the running backend adapter. */
export interface AgentCapabilities {
  inject?: boolean;
  branchSession?: boolean;
  rewindFiles?: boolean;
  editSessions?: boolean;
  deleteSessions?: boolean;
  compact?: { command: string; hintAt: number; autoAt: number };
}

import type { AgentTask, AgentTaskPatch } from "../../../../core/modules/agent-task/index.ts";
import type { Project } from "../../project/index.ts";

export type { AgentTask };

export interface AgentToolChip {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  /** What the agent passed to the tool. */
  input?: string;
  /** The result once it arrives (the input while the tool is still running). */
  detail: string;
  /** The call of a subagent (`Task`) this call was made inside of. */
  parent?: string;
}

/** A call with the calls a subagent made inside of it, for showing. */
export type AgentToolView = AgentToolChip & { children?: AgentToolChip[] };

/** The answer in the order it happened: text and tool calls interleave. */
export type AgentPart =
  | { type: "text"; text: string }
  | { type: "tool"; id: string }
  /** A message the user added while the answer was being written. */
  | { type: "note"; text: string }
  /** What the agent reasoned before answering; kept apart from the answer text. */
  | { type: "thought"; text: string };

export type AgentBackendId = "projector" | "claude-code" | "codex" | "opencode" | "cursor";

export type AgentPermissionMode = "default" | "plan" | "acceptEdits" | "auto" | "bypassPermissions";

/** A knob the agent offers for a chat: model, reasoning effort, mode. */
export interface AgentControl {
  id: string;
  category: "model" | "effort" | "mode" | "other";
  name: string;
  description?: string;
  current: string;
  options: { value: string; name: string; description?: string }[];
}

/** Choices by control id. */
export type AgentSelection = Record<string, string>;

/** A past conversation of the agent in this project. */
export interface AgentSessionInfo {
  id: string;
  title: string;
  updatedAt?: string;
  pinned?: boolean;
}

export interface AgentSessionRef {
  backend: string;
  id: string;
}

/** A reference inside a message: a project file or folder, an attached image, a slash command. */
export type MessageChip =
  | { type: "file"; path: string; directory?: boolean }
  | { type: "image"; id: string; name: string; mime: string }
  | { type: "command"; name: string };

/** A message as written: text with chips between it. */
export type MessagePart = { type: "text"; text: string } | MessageChip;

/** A slash command the agent understands. */
export interface AgentCommand {
  name: string;
  description?: string;
  hint?: string;
}

/** How full the agent's context window is, as the agent last reported it. */
export interface AgentContext {
  used: number;
  size: number;
  model?: string;
  /** Tokens at which the agent compacts the conversation on its own. */
  compactAt?: number;
  categories?: { name: string; tokens: number }[];
  cost?: { amount: number; currency: string };
}

export interface AgentTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** When the message was written (ms since the epoch); absent in turns saved before it existed. */
  at?: number;
  tools: AgentToolChip[];
  /** Subagents and background commands the agent started during this answer. */
  tasks?: AgentTask[];
  /** What the user wrote, with chips; `text` holds the same message as plain text. */
  content?: MessagePart[];
  /** Order of text and tool calls; absent in turns saved before it existed. */
  parts?: AgentPart[];
  /** Context fullness after this turn; the chat shows the latest one. */
  context?: AgentContext;
  /** Native backend session (Claude Code) this turn belongs to; the next request resumes it. */
  session?: AgentSessionRef;
  /** The agent process still answering this turn; set until the turn ends, so it can be rejoined. */
  run?: string;
  /** The isolated copy of the project this answer was written in. */
  worktree?: { id: string; branch: string };
  /** Where this answer ends in the agent's transcript; the next message branches off from here. */
  tail?: string;
  /** The agent's own session cannot go on from this turn (the chat was cut back): replay instead. */
  detached?: boolean;
  /**
   * On a user turn: the other versions of the conversation from this message on, which exist
   * after the message was edited or its answer repeated. Each version starts with a user turn.
   */
  variants?: AgentTurn[][];
  /** Which place the shown version takes among `variants` and itself. */
  slot?: number;
}

/** What rolling the chat back to a message undoes: the conversation, the files, or both. */
export type RewindScope = "conversation" | "files" | "both";

/** A message waiting for the answer in progress to end. */
export interface QueuedMessage {
  id: string;
  text: string;
  parts: MessagePart[];
}

/** A sensitive tool call waiting for the user's decision. */
export interface AgentPermission {
  id: string;
  tool: string;
  title: string;
  detail: string;
  /** The backend offers a durable "always" choice for this tool. */
  persistent: boolean;
}

/**
 * The agent asks for a secret. Only what it will be stored as is known here: the value is typed
 * into the form and sent straight to the server, never kept in the chat state.
 */
export interface AgentSecretRequest {
  id: string;
  label: string;
  reason?: string;
  destination:
    | { kind: "env_file"; file: string; key: string; replaces: boolean }
    | {
        kind: "ai_provider";
        id: string;
        name: string;
        /** Where the key will be sent: shown in full, the key is for this address. */
        url: string;
        model: string;
        replaces: boolean;
      }
    | { kind: "integration"; integration: "github" | "gitlab"; label: string; replaces: boolean };
}

/** A question the agent put to the user and waits for. */
export interface AgentQuestionRequest {
  id: string;
  title?: string;
  questions: {
    id: string;
    question: string;
    header?: string;
    options: { id: string; label: string; description?: string }[];
    multiple: boolean;
    /** The user may write an answer of their own to this question. */
    custom?: boolean;
    /** The agent goes on without an answer to this one. */
    optional?: boolean;
  }[];
  /** The user may write an answer of their own. */
  custom: boolean;
}

export interface AgentHistoryTurn {
  role: "user" | "assistant";
  content: string;
  /** What the answer's tool calls returned, for an agent that only gets the replayed chat. */
  tools?: { id: string; name: string; input?: string; output: string; failed?: boolean }[];
}

export interface AgentCommandRequest {
  id: string;
  operation: "list" | "describe" | "execute";
  query?: string;
  command?: string;
  scope?: string;
  args?: unknown;
}

export type AgentEvent =
  | { event: "command-request"; data: AgentCommandRequest }
  | {
      event: "permission-request";
      data: {
        id: string;
        tool: string;
        input: unknown;
        title?: string;
        detail?: string;
        persistent?: boolean;
      };
    }
  | { event: "question-request"; data: AgentQuestionRequest }
  | { event: "secret-request"; data: AgentSecretRequest }
  | { event: "run"; data: { id: string } }
  | { event: "checkpoint"; data: { tail: string } }
  | { event: "worktree"; data: { id: string; branch: string } }
  | { event: "session"; data: AgentSessionRef }
  | { event: "commands"; data: { commands: AgentCommand[] } }
  | { event: "context"; data: AgentContext }
  | { event: "controls"; data: { controls: AgentControl[] } }
  | { event: "status"; data: { phase: string; provider?: string; model?: string } }
  | { event: "text"; data: { text: string } }
  | { event: "tool"; data: { id: string; name: string; input: unknown; parent?: string } }
  | { event: "tool-result"; data: { id: string; name: string; output?: unknown; error?: string } }
  | { event: "task"; data: AgentTaskPatch }
  | { event: "thought"; data: { text: string } }
  | { event: "project"; data: Project }
  | { event: "done"; data: { text: string } }
  | { event: "error"; data: { error: string } };
