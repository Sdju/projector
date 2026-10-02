import type { Project } from "../../catalog/index.ts";

export interface AgentToolChip {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  detail: string;
}

export interface AgentTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: AgentToolChip[];
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
  | { event: "status"; data: { phase: string; provider?: string; model?: string } }
  | { event: "text"; data: { text: string } }
  | { event: "tool"; data: { id: string; name: string; input: unknown } }
  | { event: "tool-result"; data: { id: string; name: string; output?: unknown; error?: string } }
  | { event: "project"; data: Project }
  | { event: "done"; data: { text: string } }
  | { event: "error"; data: { error: string } };
