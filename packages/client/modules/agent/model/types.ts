/** Operations and context policy published by the running backend adapter. */
export interface AgentCapabilities {
  inject?: boolean;
  branchSession?: boolean;
  rewindFiles?: boolean;
  editSessions?: boolean;
  deleteSessions?: boolean;
  compact?: { command: string; hintAt: number; autoAt: number };
}

import type { AgentTask } from "@projector/core/modules/agent-task/index.ts";
import type { AgentRoleSnapshot } from "@projector/core/modules/agent-role/index.ts";
import type { JudgeNote } from "./judge-note.ts";
import type { AgentEvent } from "./events.ts";

export type { AgentPermission } from "./permissions.ts";
export type { AgentTurn } from "./turn.ts";
export type { AgentEvent } from "./events.ts";

export type { AgentTask };

export interface AgentToolChip {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  /** What the agent passed to the tool. */
  input?: string;
  /** The result once it arrives (the input while the tool is still running). */
  detail: string;
  /** The kind of action the agent named (ACP: read, edit, execute, search, fetch…). */
  kind?: string;
  /** Output the call has streamed so far, while it is still running. */
  output?: string;
  /** The call of a subagent (`Task`) this call was made inside of. */
  parent?: string;
  /** When the call started and ended (ms since the epoch), for showing how long it took. */
  startedAt?: number;
  endedAt?: number;
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
  | { type: "thought"; text: string }
  /** An action the judge allowed without asking; shown in the work block. */
  | ({ type: "judge" } & JudgeNote);

export type AgentBackendId = string;

export type AgentPermissionMode = string;

/** A knob the agent offers for a chat: model, reasoning effort, mode. */
export interface AgentControl {
  id: string;
  category: "model" | "effort" | "mode" | "flag" | "other";
  name: string;
  description?: string;
  current: string;
  options: { value: string; name: string; description?: string; group?: string }[];
}

/** Choices by control id. */
export type AgentSelection = Record<string, string>;

/** A past conversation of the agent in this project. */
export interface AgentSessionInfo {
  id: string;
  title: string;
  updatedAt?: string;
  pinned?: boolean;
  /** The chat a subagent branch was started from; a branch, not a chat of its own. */
  parent?: string;
  /** The agent a branch runs as (`general`, `explore`, ...), when known. */
  agent?: string;
}

/** A chat of the project kept on disk: open in a tab, or closed with its history still saved. */
export interface AgentRecentChat {
  /** The chat key, which names its tab (`ide.workbench.<agent>.open`). */
  chat: string;
  backend: string;
  title: string;
  updatedAt: string;
  /** Native session this chat continues: its session row and this chat are one entry. */
  session?: string;
  /** The role the chat started with; kept even when the role is edited or deleted. */
  role?: AgentRoleSnapshot;
}

export interface AgentSessionRef {
  backend: string;
  id: string;
}

/** A range of lines, both ends included and counted from 1. */
export type FileRange = { from: number; to: number };

/** A reference inside a message: a project file or folder, an attached image, a slash command. */
export type MessageChip =
  | { type: "file"; path: string; directory?: boolean; range?: FileRange }
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

/** A read-only snapshot of a chat, for `ide.agent.chat.status` and side diagnostics. */
export interface AgentChatStatus {
  chat: string;
  backend: string;
  busy: boolean;
  phase: string;
  startedAt?: number;
  elapsedMs?: number;
  lastEventAt?: number;
  sinceLastEventMs?: number;
  currentTools: { name: string; input?: string; startedAt?: number; elapsedMs?: number }[];
  pending: {
    permissions: { tool: string; title: string }[];
    questions: { title?: string; count: number }[];
    secrets: { label: string }[];
  };
  queue: { count: number; texts: string[] };
  /** `checked: false` means the live-run list could not be read, not that no process exists. */
  live: { found: boolean; checked?: boolean; run?: string; startedAt?: number };
  health:
    | "idle"
    | "active"
    | "quiet"
    | "running-tool"
    | "waiting-user"
    | "waiting-background"
    | "broken";
  lastAssistantText?: string;
  session?: string;
  context?: AgentContext;
}

/** Tokens an answer used, split by how the prompt cache served them. */
export interface AgentTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Running totals of a chat: tokens, and cost over the answers that had a price. */
export interface ChatUsage {
  tokens: number;
  cost: number;
  /** At least one answer had a price, so the cost means something. */
  priced: boolean;
}

export interface AgentUsage extends AgentTokens {
  /** The answer's first request: whether the conversation so far was found in the cache. */
  first?: AgentTokens;
  /** What the answer cost at the model's price, in the currency of its tariff; unset without a price. */
  cost?: number;
}

/** A form the agent offered and the user answered: its markup and the values that were sent. */
export interface AgentFormAnswer {
  /** The form or panel block exactly as the agent wrote it. */
  source: string;
  /** The values the user submitted; the form's controls show them again. */
  values: unknown;
  /** The line the submit button put before the values. */
  summary?: string;
}

/** What rolling the chat back to a message undoes: the conversation, the files, or both. */
export type RewindScope = "conversation" | "files" | "both";

/** A message waiting for the answer in progress to end. */
export interface QueuedMessage {
  delivering?: boolean;
  id: string;
  text: string;
  parts: MessagePart[];
  /** A form answer keeps the block it came from, so the user's message can show it again. */
  form?: AgentFormAnswer;
  /** The IDE wrote this message after a job: it is shown as a continuation note. */
  auto?: string;
  /** The job's name for that note; the id remains in `auto`. */
  autoTitle?: string;
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
    | {
        kind: "integration";
        integration: "github" | "gitlab" | "web_search";
        label: string;
        replaces: boolean;
      };
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
  /**
   * What the assistant reasoned before answering. Lens reads it to name the intent; ordinary
   * replay does not send it back to the agent.
   */
  thoughts?: string;
  /** What the answer's tool calls returned, for an agent that only gets the replayed chat. */
  tools?: { id: string; name: string; input?: string; output: string; failed?: boolean }[];
}

/** One earlier question asked in the side panel; it never enters the chat history. */
export interface AgentSideExchange {
  question: string;
  answer: string;
}

/** A tool call still running when the side question was asked. */
export interface AgentSideRunningTool {
  name: string;
  input?: string;
  startedAt?: number;
}

/** One step of the chat's current plan. */
export interface AgentSidePlanItem {
  content: string;
  status: string;
}

/** Who answers a side question: the built-in Projector agent, by default on the active provider. */
export interface AgentSideMeta {
  mode: "projector";
  chat?: string;
  provider?: string;
  model?: string;
  readOnly?: boolean;
}

/** A side answer also says who answers it; the rest is the ordinary chat event stream. */
export type AgentSideEvent =
  | AgentEvent
  | {
      event: "meta";
      data: AgentSideMeta;
    };

export interface AgentCommandRequest {
  id: string;
  operation: "list" | "describe" | "execute";
  query?: string;
  command?: string;
  scope?: string;
  args?: unknown;
}
