import type { AgentPlanCall, AgentPlanItem } from "../catalog/index.ts";

const STATUSES: Record<string, AgentPlanItem["status"]> = {
  pending: "pending",
  in_progress: "in_progress",
  done: "completed",
};

/** Kimi's `TodoList`: `{ todos: [{ title, status }] }`; a call without `todos` only reads it. */
export function readKimiPlan(call: AgentPlanCall): AgentPlanItem[] | undefined {
  if (call.name !== "TodoList" || !call.input) return undefined;
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
    const { title, status } = item as Record<string, unknown>;
    const state = typeof status === "string" ? STATUSES[status] : undefined;
    if (typeof title !== "string" || !title.trim() || !state) return [];
    return [{ content: title, status: state }];
  });
}
