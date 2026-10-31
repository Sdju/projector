import { tool } from "ai";
import { z } from "zod";
import type { CommandRequest } from "../../agent/index.ts";
import { summarySection } from "./projector-compaction.ts";

/** The system prompt of a side question: read-only, not the main chat, no tools beyond state. */
export const SIDE_PROMPT = `Ты отвечаешь на вопрос «в сторону» о текущем чате Projector. Это не основной разговор: твой ответ не попадёт в историю чата и не должен менять его состояние.
У тебя есть только чтение состояния: chat_status (состояние чата) и list_chats (открытые чаты проекта). Файлов, команд, MCP, интернета, памяти и любых изменений у тебя нет.
Если вопрос о том, что происходит сейчас, сначала вызови chat_status. Не гадай о busy, фазе, очереди и ожидающих запросах.
Не утверждай, что процесс завис, только потому что давно не было событий: модель может долго думать. Скажи факты — жив ли процесс, сколько времени нет событий, что выполняется и чего чат ждёт, — и только потом предположение.
Отвечай по-русски, коротко и по делу. Если данных не хватает или проверка не удалась, скажи, что именно не удалось проверить.`;

/** A side question is short: four model steps and 45 seconds are enough for one status check. */
export const SIDE_LIMITS = { seconds: 45, tokens: 0, steps: 4 };

/** Bounds the whole side request, including a model call or browser command that never finishes. */
export function sideAbort(signal: AbortSignal | undefined, seconds = SIDE_LIMITS.seconds) {
  const timeout = AbortSignal.timeout(seconds * 1_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** The system prompt of a side question, plus the summary the main chat already had. */
export function sideSystem(cwd: string | undefined, summary: string): string {
  return SIDE_PROMPT + (cwd ? `\n\nПроект: ${cwd}` : "") + summarySection(summary);
}

export interface SideToolContext {
  /** Runs an IDE command in the open Projector page; absent when no page is attached. */
  commands?: (request: CommandRequest) => Promise<unknown>;
  /** The chat the question belongs to. */
  chat?: string;
  /** The live command scope of that chat, `editor:<projectId>`. */
  scope?: string;
}

function commandCall(context: SideToolContext, command: string, args: Record<string, unknown>) {
  if (!context.commands || !context.scope)
    throw new Error("Состояние чата недоступно: страница Projector не подключена");
  return context.commands({
    operation: "execute",
    command,
    scope: context.scope,
    args,
  });
}

/**
 * The read-only tools of a side question. There is deliberately no generic command tool, no
 * shell, no MCP and no file access: a side question must never change the project or the chat.
 */
export function createSideTools(context: SideToolContext) {
  return {
    chat_status: tool({
      description:
        "Состояние чата агента: занят ли он, фаза, сколько идёт, когда было последнее событие, какие инструменты выполняются, ждёт ли разрешения или ответа, очередь, живой процесс и сессия. Только чтение.",
      inputSchema: z.object({
        chat: z
          .string()
          .optional()
          .describe("Ключ чата из list_chats; без него — чат, к которому относится вопрос"),
      }),
      execute: async ({ chat }) => {
        const key = chat ?? context.chat;
        return commandCall(context, "ide.agent.chat.status", key ? { chat: key } : {});
      },
    }),
    list_chats: tool({
      description:
        "Открытые чаты агентов проекта: ключ, агент, занят ли он и число сообщений. Только чтение.",
      inputSchema: z.object({}),
      execute: async () => commandCall(context, "ide.agent.chats.list", {}),
    }),
  };
}
