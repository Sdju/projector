import type { AgentTask } from "@ai-projector/core/modules/agent-task/index.ts";

/**
 * What the chat lets the user tune for an external agent. Every agent describes its own knobs
 * (Codex: model, reasoning effort, approval preset; Cursor: model, mode; OpenCode: model, effort,
 * agent), so they travel as data and the UI renders whatever it receives.
 */
export type AgentControlCategory = "model" | "effort" | "mode" | "flag" | "other";

export interface AgentControlOption {
  value: string;
  name: string;
  description?: string;
  /** Select group this value belongs to, when the agent sent grouped options. */
  group?: string;
}

export interface AgentControl {
  id: string;
  category: AgentControlCategory;
  name: string;
  description?: string;
  current: string;
  options: AgentControlOption[];
  /** How the value is applied over ACP; Claude Code uses `native`. */
  via: "config" | "model" | "mode" | "native";
  /** ACP `boolean` option: the value is sent as a JSON boolean, not a string. */
  boolean?: true;
}

/** Values chosen by the user, by control id. */
export type AgentSelection = Record<string, string>;

export interface AgentSessionInfo {
  id: string;
  title: string;
  /** ISO time of the last activity. */
  updatedAt?: string;
  /** Kept at the top of the list by the user. */
  pinned?: boolean;
  /**
   * The session this one was started from. A subagent works in its own native session, and the
   * agent lists it next to real chats: the id lets history keep it apart from them.
   */
  parent?: string;
  /** The agent a branch runs as (`general`, `explore`, ...), when the agent names it. */
  agent?: string;
}

/** One replayed message of a past session, in the shape the chat stores. */
export interface AgentSessionTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: {
    id: string;
    name: string;
    status: "running" | "done" | "error";
    detail: string;
    parent?: string;
  }[];
  session?: { backend: string; id: string };
  /** When the message was written, in ms since the epoch; absent when the agent does not tell. */
  at?: number;
  /** Instructions Projector injected before the user's text, kept for a separate view. */
  injected?: string;
  /** Text, reasoning and tool calls in the order they happened. */
  parts?: AgentSessionPart[];
  /** Subagents and background commands the answer started. */
  tasks?: AgentTask[];
}

export type AgentSessionPart =
  | { type: "text"; text: string }
  | { type: "tool"; id: string }
  | { type: "note"; text: string }
  | { type: "thought"; text: string };

/** Longest list sent to the client: agents may hold thousands of past sessions. */
export const SESSION_LIST_LIMIT = 30;

export function selectionFrom(value: unknown): AgentSelection {
  const selection: AgentSelection = {};
  if (value && typeof value === "object")
    for (const [id, item] of Object.entries(value as Record<string, unknown>))
      if (typeof item === "string" && id.length <= 100 && item.length <= 300) selection[id] = item;
  return selection;
}
