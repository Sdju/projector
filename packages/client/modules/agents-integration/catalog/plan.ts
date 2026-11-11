/** One item of the agent's own task list, as the chat pins and shows it. */
export interface AgentPlanItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  /** What the agent says while the item is being done. */
  active?: string;
}

/** A tool call a plan reader may recognize. */
export interface AgentPlanCall {
  name: string;
  input?: string;
}

/**
 * Reads one tool call as a task list: `undefined` when the call does not carry one, `[]` when the
 * agent cleared the list. The schema belongs to the agent, so the shared chat only asks this reader.
 */
export type AgentPlanReader = (call: AgentPlanCall) => AgentPlanItem[] | undefined;

const STATUSES: Record<string, AgentPlanItem["status"]> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
  done: "completed",
};

/**
 * Reads `{ todos: [{ content|title, status }] }` from the tool names a plugin declared.
 * Built-in agents keep their own readers; this is the generic shape ACP plugins can emit.
 */
export function readTodosPlan(tools: readonly string[]): AgentPlanReader {
  const names = new Set(tools);
  return (call: AgentPlanCall): AgentPlanItem[] | undefined => {
    if (!names.has(call.name) || !call.input) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(call.input);
    } catch {
      return undefined;
    }
    const todos = (value as { todos?: unknown }).todos;
    if (!Array.isArray(todos)) return undefined;
    return todos.flatMap((item): AgentPlanItem[] => {
      if (!item || typeof item !== "object") return [];
      const { content, title, status } = item as Record<string, unknown>;
      const text = typeof content === "string" ? content : typeof title === "string" ? title : "";
      const state = typeof status === "string" ? STATUSES[status] : undefined;
      if (!text.trim() || !state) return [];
      return [{ content: text, status: state }];
    });
  };
}
