import type { AgentRunOptions } from "./api.ts";
import { cursorTodos, rememberCursorTodos } from "./todos.ts";

const text = (value: unknown, limit: number) =>
  typeof value === "string" ? value.slice(0, limit) : "";

/**
 * `cursor/create_plan`: show the todos on the plan island and ask the user to accept or reject.
 * Without a prompt (a job with no UI) the plan is accepted so the turn can continue.
 */
export async function createCursorPlan(
  options: AgentRunOptions,
  params: Record<string, unknown>,
): Promise<unknown> {
  const todos = cursorTodos(params);
  const id = text(params.toolCallId, 200) || "create_plan";
  if (todos.length) {
    rememberCursorTodos(options, todos);
    options.emit("tool", { id, name: "create_plan", input: { todos } });
    options.emit("tool-result", { id, name: "create_plan", output: "" });
  }
  if (!options.ask) return { outcome: { outcome: "accepted" } };
  const name = text(params.name, 300) || "План";
  const overview = text(params.overview, 2000);
  const plan = text(params.plan, 8000);
  const answer = await options
    .ask({
      title: name,
      custom: false,
      questions: [
        {
          id: "plan",
          question: [overview, plan].filter(Boolean).join("\n\n") || name,
          options: [
            { id: "accept", label: "Принять план" },
            { id: "reject", label: "Отклонить" },
          ],
          multiple: false,
        },
      ],
    })
    .catch(() => undefined);
  if (answer === undefined || answer === null) return { outcome: { outcome: "cancelled" } };
  if (answer.plan?.includes("accept")) return { outcome: { outcome: "accepted" } };
  if (answer.plan?.includes("reject"))
    return { outcome: { outcome: "rejected", reason: "Пользователь отклонил план" } };
  return { outcome: { outcome: "cancelled" } };
}
