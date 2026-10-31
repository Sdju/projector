import { asString } from "../transport/index.ts";
import type { AgentHistoryTurn } from "../providers/index.ts";
import { selectionFrom, type AgentSelection } from "./controls.ts";
import { historyTools } from "./request.ts";

const QUESTION_CHARS = 4_000;
const HISTORY_TURNS = 200;
const HISTORY_CHARS = 80_000;
const TURN_CHARS = 20_000;
const THREAD_EXCHANGES = 20;
const THREAD_ANSWER_CHARS = 4_000;
const RUNNING_TOOLS = 20;
const PLAN_ITEMS = 30;

export interface SideExchange {
  question: string;
  answer: string;
}

export interface SideRunningTool {
  name: string;
  input?: string;
  startedAt?: number;
}

export interface SidePlanItem {
  content: string;
  status: string;
}

/** A parsed question for the read-only side agent; nothing here is saved. */
export interface SideRequest {
  question: string;
  /** The user message sent to the model: the question with the earlier side thread and live state. */
  message: string;
  history: AgentHistoryTurn[];
  thread: SideExchange[];
  running: SideRunningTool[];
  plan: SidePlanItem[];
  chat: string;
  projectId: string;
  selection: AgentSelection;
  providerId?: string;
}

function text(value: unknown, limit: number): string {
  return asString(value).trim().slice(0, limit);
}

function exchanges(value: unknown): SideExchange[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-THREAD_EXCHANGES).flatMap((item): SideExchange[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const question = text(row.question, QUESTION_CHARS);
    const answer = text(row.answer, THREAD_ANSWER_CHARS);
    return question && answer ? [{ question, answer }] : [];
  });
}

function runningTools(value: unknown): SideRunningTool[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, RUNNING_TOOLS).flatMap((item): SideRunningTool[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const name = text(row.name, 100);
    if (!name) return [];
    return [
      {
        name,
        ...(row.input ? { input: text(row.input, 500) } : {}),
        ...(typeof row.startedAt === "number" && Number.isFinite(row.startedAt)
          ? { startedAt: row.startedAt }
          : {}),
      },
    ];
  });
}

function planItems(value: unknown): SidePlanItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, PLAN_ITEMS).flatMap((item): SidePlanItem[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const content = text(row.content, 300);
    if (!content) return [];
    return [{ content, status: text(row.status, 40) || "pending" }];
  });
}

const weight = (turn: AgentHistoryTurn) =>
  turn.content.length +
  (turn.tools ?? []).reduce((sum, tool) => sum + (tool.input?.length ?? 0) + tool.output.length, 0);

/** Oldest whole exchanges go first: the side question is about now, not the start of the chat. */
function fitHistory(turns: AgentHistoryTurn[]): AgentHistoryTurn[] {
  let total = turns.reduce((sum, turn) => sum + weight(turn), 0);
  let start = 0;
  while (start < turns.length && (total > HISTORY_CHARS || turns[start]!.role !== "user")) {
    total -= weight(turns[start]!);
    start++;
    while (start < turns.length && turns[start]!.role !== "user") {
      total -= weight(turns[start]!);
      start++;
    }
  }
  return turns.slice(start);
}

function history(value: unknown): AgentHistoryTurn[] {
  if (!Array.isArray(value)) return [];
  return fitHistory(
    value.slice(-HISTORY_TURNS).flatMap((item): AgentHistoryTurn[] => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const role = row.role === "assistant" ? "assistant" : row.role === "user" ? "user" : null;
      const content = asString(row.content).slice(0, TURN_CHARS);
      const tools = historyTools(row.tools);
      if (!role || (!content.trim() && !tools.length)) return [];
      return [{ role, content, ...(tools.length ? { tools } : {}) }];
    }),
  );
}

/** The question with what the side model should know before it can call the status tool. */
function sideMessage(
  question: string,
  thread: SideExchange[],
  running: SideRunningTool[],
  plan: SidePlanItem[],
): string {
  const blocks: string[] = [];
  if (thread.length)
    blocks.push(
      [
        "Ранее в стороне спрашивали (это не часть основного разговора):",
        ...thread.map(
          (item, index) => `${index + 1}. Вопрос: ${item.question}\n   Ответ: ${item.answer}`,
        ),
      ].join("\n"),
    );
  if (running.length)
    blocks.push(
      [
        "Сейчас выполняется:",
        ...running.map((item) => `- ${item.name}${item.input ? `: ${item.input}` : ""}`),
      ].join("\n"),
    );
  if (plan.length)
    blocks.push(
      ["Текущий план:", ...plan.map((item) => `- [${item.status}] ${item.content}`)].join("\n"),
    );
  blocks.push(`Вопрос в сторону:\n${question}`);
  return blocks.join("\n\n");
}

/** A side question from `POST /api/agent/side`; malformed parts are dropped, sizes bounded. */
export function sideRequestFrom(body: Record<string, unknown>): SideRequest {
  const question = text(body.question, QUESTION_CHARS);
  if (!question) throw new Error("Напишите вопрос в сторону");
  const thread = exchanges(body.thread);
  const running = runningTools(body.running);
  const plan = planItems(body.plan);
  return {
    question,
    message: sideMessage(question, thread, running, plan),
    history: history(body.history),
    thread,
    running,
    plan,
    chat: text(body.chat, 200),
    projectId: text(body.projectId, 200),
    selection: selectionFrom(body.selection),
    providerId: text(body.providerId, 200) || undefined,
  };
}
