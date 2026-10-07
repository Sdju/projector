import type { Project } from "../../project/index.ts";

export interface AgentToolChip {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  detail: string;
}

export type AgentBackendId = "projector" | "claude-code" | "codex" | "opencode" | "cursor";

export type AgentPermissionMode = "default" | "acceptEdits" | "bypassPermissions";

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

export interface AgentTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: AgentToolChip[];
  /** Native backend session (Claude Code) this turn belongs to; the next request resumes it. */
  session?: AgentSessionRef;
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
  | { event: "session"; data: AgentSessionRef }
  | { event: "controls"; data: { controls: AgentControl[] } }
  | { event: "status"; data: { phase: string; provider?: string; model?: string } }
  | { event: "text"; data: { text: string } }
  | { event: "tool"; data: { id: string; name: string; input: unknown } }
  | { event: "tool-result"; data: { id: string; name: string; output?: unknown; error?: string } }
  | { event: "project"; data: Project }
  | { event: "done"; data: { text: string } }
  | { event: "error"; data: { error: string } };
