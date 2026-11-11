import type { AgentRunOptions } from "./api.ts";

const STATUSES = new Set(["pending", "in_progress", "completed"]);

export interface CursorTodo {
  id?: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

const text = (value: unknown, limit: number) =>
  typeof value === "string" ? value.slice(0, limit) : "";

function statusOf(value: unknown): CursorTodo["status"] {
  if (value === "completed" || value === "in_progress") return value;
  return "pending";
}

/** Todos from a plan or an update: phases flatten when the top-level list is empty. */
export function cursorTodos(params: Record<string, unknown>): CursorTodo[] {
  const direct = readList(params.todos);
  if (direct.length) return direct;
  const phases = Array.isArray(params.phases) ? params.phases : [];
  return phases.flatMap((phase) => readList((phase as { todos?: unknown } | null)?.todos));
}

function readList(raw: unknown): CursorTodo[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): CursorTodo[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const content = text(row.content, 500) || text(row.id, 200);
    if (!content) return [];
    return [
      {
        ...(text(row.id, 200) ? { id: text(row.id, 200) } : {}),
        content,
        status: STATUSES.has(String(row.status)) ? statusOf(row.status) : "pending",
      },
    ];
  });
}

const lastByChat = new Map<string, CursorTodo[]>();

function chatKey(options: AgentRunOptions): string {
  return options.chat || options.sessionId || "";
}

export function rememberCursorTodos(options: AgentRunOptions, todos: CursorTodo[]): void {
  lastByChat.set(chatKey(options), todos);
}

function mergeTodos(chat: string, incoming: CursorTodo[], merge: boolean): CursorTodo[] {
  if (!merge) {
    lastByChat.set(chat, incoming);
    return incoming;
  }
  const previous = lastByChat.get(chat) ?? [];
  const byId = new Map(previous.filter((item) => item.id).map((item) => [item.id!, item]));
  const merged = [...previous];
  for (const item of incoming) {
    if (item.id && byId.has(item.id)) {
      const index = merged.findIndex((row) => row.id === item.id);
      if (index >= 0) merged[index] = { ...merged[index], ...item };
    } else merged.push(item);
  }
  lastByChat.set(chat, merged);
  return merged;
}

/** `cursor/update_todos`: the island reads the emitted tool; merge keeps the last full list. */
export async function updateCursorTodos(
  options: AgentRunOptions,
  params: Record<string, unknown>,
): Promise<unknown> {
  const todos = mergeTodos(chatKey(options), cursorTodos(params), params.merge === true);
  const id = text(params.toolCallId, 200) || "update_todos";
  options.emit("tool", { id, name: "update_todos", input: { todos } });
  options.emit("tool-result", { id, name: "update_todos", output: "" });
  return {};
}
