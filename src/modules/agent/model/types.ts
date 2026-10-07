import type { Project } from "../../project/index.ts";

export interface AgentToolChip {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  detail: string;
}

export type AgentBackendId = "projector" | "claude-code";

export type AgentPermissionMode = "default" | "acceptEdits" | "bypassPermissions";

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
      data: { id: string; tool: string; input: unknown; title?: string };
    }
  | { event: "session"; data: AgentSessionRef }
  | { event: "status"; data: { phase: string; provider?: string; model?: string } }
  | { event: "text"; data: { text: string } }
  | { event: "tool"; data: { id: string; name: string; input: unknown } }
  | { event: "tool-result"; data: { id: string; name: string; output?: unknown; error?: string } }
  | { event: "project"; data: Project }
  | { event: "done"; data: { text: string } }
  | { event: "error"; data: { error: string } };
