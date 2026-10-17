import {
  getSessionMessages,
  listSessions,
  renameSession,
  tagSession,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentControl, AgentSessionInfo, AgentSessionTurn } from "../../agent/index.ts";
import { SESSION_LIST_LIMIT } from "../../agent/index.ts";

/** Claude Code accepts model aliases, so the list does not go stale with every release. */
const permissionOptions = [
  { value: "default", name: "Спрашивать", description: "Запрос перед правками и командами" },
  {
    value: "plan",
    name: "План",
    description: "Агент сначала составляет план без правок и ждёт вашего согласия",
  },
  {
    value: "acceptEdits",
    name: "Правки без вопросов",
    description: "Файлы меняются сразу, команды — по запросу",
  },
  {
    value: "auto",
    name: "Авто",
    description: "Классификатор сам разрешает безопасное и спрашивает о рискованном",
  },
  {
    value: "bypassPermissions",
    name: "Всё без вопросов",
    description: "Без запросов разрешений",
  },
];

export const CLAUDE_CONTROLS: AgentControl[] = [
  {
    id: "permission-mode",
    via: "native",
    category: "mode",
    name: "Разрешения",
    description: "Когда агент спрашивает подтверждение",
    current: "default",
    options: permissionOptions,
  },
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
  {
    id: "budget",
    category: "other",
    name: "Бюджет хода",
    description: "Ход прекращается, когда его стоимость достигает предела (доллары США)",
    current: "default",
    via: "native",
    options: [
      { value: "default", name: "Без предела" },
      { value: "1", name: "1 $" },
      { value: "5", name: "5 $" },
      { value: "20", name: "20 $" },
    ],
  },
  {
    id: "steps",
    category: "other",
    name: "Шагов в ходе",
    description: "Сколько раз агент может обратиться к модели за один ход",
    current: "default",
    via: "native",
    options: [
      { value: "default", name: "Без предела" },
      { value: "10", name: "10" },
      { value: "30", name: "30" },
      { value: "100", name: "100" },
    ],
  },
];

export async function claudeSessions(cwd: string): Promise<AgentSessionInfo[]> {
  const sessions = await listSessions({ dir: cwd, limit: SESSION_LIST_LIMIT });
  return sessions
    .map((session) => ({
      id: session.sessionId,
      title:
        (session.customTitle || session.summary || session.firstPrompt || "").trim() ||
        "Без названия",
      updatedAt: new Date(session.lastModified).toISOString(),
      ...(session.tag === PINNED_TAG ? { pinned: true } : {}),
    }))
    .sort(
      (a, b) =>
        Number(b.pinned === true) - Number(a.pinned === true) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
}

const PINNED_TAG = "pinned";

/** Renames a session and pins or unpins it; Claude Code keeps both in its own transcript. */
export async function claudeUpdateSession(
  cwd: string,
  sessionId: string,
  change: { title?: string; pinned?: boolean },
): Promise<void> {
  if (change.title !== undefined) {
    const title = change.title.trim();
    if (!title) throw new Error("Название не может быть пустым");
    await renameSession(sessionId, title.slice(0, 200), { dir: cwd });
  }
  if (change.pinned !== undefined)
    await tagSession(sessionId, change.pinned ? PINNED_TAG : null, { dir: cwd });
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
