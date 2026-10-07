import { getSessionMessages, listSessions } from "@anthropic-ai/claude-agent-sdk";
import type { AgentControl, AgentSessionInfo, AgentSessionTurn } from "./controls.ts";
import { SESSION_LIST_LIMIT } from "./controls.ts";

/** Claude Code accepts model aliases, so the list does not go stale with every release. */
export const CLAUDE_CONTROLS: AgentControl[] = [
  {
    id: "model",
    category: "model",
    name: "Модель",
    description: "Модель Claude Code; «По умолчанию» берёт выбор из настроек Claude",
    current: "default",
    via: "native",
    options: [
      { value: "default", name: "По умолчанию" },
      { value: "opus", name: "Opus" },
      { value: "sonnet", name: "Sonnet" },
      { value: "haiku", name: "Haiku" },
    ],
  },
  {
    id: "effort",
    category: "effort",
    name: "Усилие",
    description: "Сколько Claude думает над ответом; модель без поддержки уровня понижает его сама",
    current: "default",
    via: "native",
    options: [
      { value: "default", name: "По умолчанию" },
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
      { value: "xhigh", name: "Xhigh" },
      { value: "max", name: "Max" },
    ],
  },
];

export async function claudeSessions(cwd: string): Promise<AgentSessionInfo[]> {
  const sessions = await listSessions({ dir: cwd, limit: SESSION_LIST_LIMIT });
  return sessions
    .map((session) => ({
      id: session.sessionId,
      title: (session.summary || session.firstPrompt || "").trim() || "Без названия",
      updatedAt: new Date(session.lastModified).toISOString(),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

interface Block {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

const blocksOf = (content: unknown): Block[] =>
  typeof content === "string"
    ? [{ type: "text", text: content }]
    : Array.isArray(content)
      ? (content as Block[])
      : [];

function stringify(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 8000);
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2).slice(0, 8000);
  } catch {
    return "";
  }
}

/** The chat shape of a stored Claude Code transcript: text per turn, tool calls as chips. */
export async function claudeLoadSession(
  cwd: string,
  sessionId: string,
): Promise<AgentSessionTurn[]> {
  const messages = await getSessionMessages(sessionId, { dir: cwd });
  const turns: AgentSessionTurn[] = [];
  let counter = 0;
  const turnFor = (role: "user" | "assistant"): AgentSessionTurn => {
    const last = turns.at(-1);
    if (last?.role === role) return last;
    const turn: AgentSessionTurn = {
      id: `replay-${++counter}`,
      role,
      text: "",
      tools: [],
      ...(role === "assistant" ? { session: { backend: "claude-code", id: sessionId } } : {}),
    };
    turns.push(turn);
    return turn;
  };
  for (const message of messages) {
    if (message.type === "system" || message.parent_tool_use_id) continue;
    const content = (message.message as { content?: unknown } | null)?.content;
    for (const block of blocksOf(content)) {
      if (message.type === "assistant") {
        if (block.type === "text" && block.text) turnFor("assistant").text += block.text;
        else if (block.type === "tool_use" && block.id)
          turnFor("assistant").tools.push({
            id: block.id,
            name: block.name ?? "tool",
            status: "running",
            detail: stringify(block.input),
          });
      } else if (block.type === "text" && block.text) turnFor("user").text += block.text;
      else if (block.type === "tool_result") {
        const chip = turns
          .flatMap((turn) => turn.tools)
          .find((item) => item.id === block.tool_use_id);
        if (chip) {
          chip.status = block.is_error ? "error" : "done";
          const output = stringify(
            typeof block.content === "string"
              ? block.content
              : blocksOf(block.content)
                  .map((part) => part.text ?? "")
                  .join("\n"),
          );
          if (output) chip.detail = output;
        }
      }
    }
  }
  return turns.filter((turn) => turn.text.trim() || turn.tools.length);
}
