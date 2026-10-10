import type { AgentTurn } from "../model/types.ts";

export interface PlanItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  /** What the agent says while the item is being done. */
  active?: string;
}

const STATUSES = new Set(["pending", "in_progress", "completed"]);

/** The task list the agent kept in its last answer (the latest `TodoWrite` call), if any. */
export function latestPlan(turn: AgentTurn | undefined): PlanItem[] {
  if (turn?.role !== "assistant") return [];
  const call = turn.tools.findLast((tool) => tool.name === "TodoWrite" && tool.input);
  if (!call?.input) return [];
  try {
    const todos = (JSON.parse(call.input) as { todos?: unknown }).todos;
    if (!Array.isArray(todos)) return [];
    return todos.flatMap((item): PlanItem[] => {
      const todo = item as { content?: unknown; status?: unknown; activeForm?: unknown };
      if (typeof todo.content !== "string" || typeof todo.status !== "string") return [];
      if (!STATUSES.has(todo.status)) return [];
      return [
        {
          content: todo.content,
          status: todo.status as PlanItem["status"],
          ...(typeof todo.activeForm === "string" ? { active: todo.activeForm } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}
