import type { AgentPlanCall, AgentPlanItem } from "../catalog/index.ts";

const STATUSES: Record<string, AgentPlanItem["status"]> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
};

const NAMES = new Set(["create_plan", "update_todos"]);

/** Cursor's plan/todos tools: `{ todos: [{ content, status }] }`. */
export function readCursorPlan(call: AgentPlanCall): AgentPlanItem[] | undefined {
  if (!NAMES.has(call.name) || !call.input) return undefined;
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
    const { content, status } = item as Record<string, unknown>;
    const state = typeof status === "string" ? STATUSES[status] : undefined;
    if (typeof content !== "string" || !content.trim() || !state) return [];
    return [{ content, status: state }];
  });
}
