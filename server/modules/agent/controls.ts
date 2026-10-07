/**
 * What the chat lets the user tune for an external agent. Every agent describes its own knobs
 * (Codex: model, reasoning effort, approval preset; Cursor: model, mode; OpenCode: model, effort,
 * agent), so they travel as data and the UI renders whatever it receives.
 */
export type AgentControlCategory = "model" | "effort" | "mode" | "other";

export interface AgentControlOption {
  value: string;
  name: string;
  description?: string;
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
}

/** Values chosen by the user, by control id. */
export type AgentSelection = Record<string, string>;

export interface AgentSessionInfo {
  id: string;
  title: string;
  /** ISO time of the last activity. */
  updatedAt?: string;
}

/** One replayed message of a past session, in the shape the chat stores. */
export interface AgentSessionTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: { id: string; name: string; status: "running" | "done" | "error"; detail: string }[];
  session?: { backend: string; id: string };
}

/** Longest list sent to the client: agents may hold thousands of past sessions. */
export const SESSION_LIST_LIMIT = 30;

export function selectionFrom(value: unknown): AgentSelection {
  const selection: AgentSelection = {};
  if (value && typeof value === "object")
    for (const [id, item] of Object.entries(value as Record<string, unknown>))
      if (typeof item === "string" && id.length <= 100 && item.length <= 300) selection[id] = item;
  return selection;
}
