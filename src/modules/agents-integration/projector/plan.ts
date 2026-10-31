import type { AgentPlanCall, AgentPlanItem } from "../catalog/index.ts";

const STATUSES: Record<string, AgentPlanItem["status"]> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
};

/** Projector's `TodoWrite`: `{ todos: [{ content, status, activeForm }] }`. */
export function readProjectorPlan(call: AgentPlanCall): AgentPlanItem[] | undefined {
  if (call.name !== "TodoWrite" || !call.input) return undefined;
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
    const { content, status, activeForm } = item as Record<string, unknown>;
    const state = typeof status === "string" ? STATUSES[status] : undefined;
    if (typeof content !== "string" || !content.trim() || !state) return [];
    return [
      {
        content,
        status: state,
        ...(typeof activeForm === "string" ? { active: activeForm } : {}),
      },
    ];
  });
}
