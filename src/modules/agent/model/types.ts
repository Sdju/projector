import type { Project } from "../../project/index.ts";

export interface AgentToolChip {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  /** What the agent passed to the tool. */
  input?: string;
  /** The result once it arrives (the input while the tool is still running). */
  detail: string;
}

/** The answer in the order it happened: text and tool calls interleave. */
export type AgentPart = { type: "text"; text: string } | { type: "tool"; id: string };

export type AgentBackendId = "projector" | "claude-code" | "codex" | "opencode" | "cursor";

export type AgentPermissionMode = "default" | "acceptEdits" | "auto" | "bypassPermissions";

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
  tools: AgentToolChip[];
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

export interface AgentHistoryTurn {
  role: "user" | "assistant";
  content: string;
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
  | { event: "run"; data: { id: string } }
  | { event: "session"; data: AgentSessionRef }
  | { event: "context"; data: AgentContext }
  | { event: "controls"; data: { controls: AgentControl[] } }
  | { event: "status"; data: { phase: string; provider?: string; model?: string } }
  | { event: "text"; data: { text: string } }
  | { event: "tool"; data: { id: string; name: string; input: unknown } }
  | { event: "tool-result"; data: { id: string; name: string; output?: unknown; error?: string } }
  | { event: "project"; data: Project }
  | { event: "done"; data: { text: string } }
  | { event: "error"; data: { error: string } };
