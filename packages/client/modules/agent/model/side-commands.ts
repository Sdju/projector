import { commandArgs } from "../../../common/utilities/commands.ts";
import { chatsOf, resolveChat } from "../../agent-core/index.ts";
import type { RegisterCommand } from "../../agent-core/index.ts";

const CHAT = "Ключ чата из ide.agent.chats.list; без него — чат, с которым работали последним";

function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Укажите ${key}`);
  return value.trim();
}

/**
 * The side question and its read-only status command. They live beside the chat because the chat
 * is a tab that comes and goes, while the side agent needs the command for as long as the project.
 */
export function registerSideCommands(register: RegisterCommand, projectId: string): void {
  const anyChat = () => chatsOf(projectId).length > 0;
  const find = (args: unknown) => resolveChat(projectId, commandArgs(args).chat);

  register(
    "ide.agent.side.open",
    "Открыть вопрос в сторону",
    (args) => find(args).openSide(),
    anyChat,
    undefined,
    {
      description:
        "Открывает панель вопроса в сторону: ответ читается по контексту чата и не попадает в его историю. Не прерывает активный ход агента.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.side.ask",
    "Спросить в сторону",
    async (args) => ({ answer: await find(args).askSide(text(commandArgs(args), "text")) }),
    anyChat,
    undefined,
    {
      description:
        "Задаёт вопрос в сторону и ждёт ответ. Работает и во время ответа агента; вопрос и ответ не записываются в чат. Ответ даёт Projector по видимой переписке и только читает состояние чата.",
      arguments: { text: "Текст вопроса", chat: CHAT },
    },
  );
  register(
    "ide.agent.side.clear",
    "Очистить историю вопросов в сторону",
    (args) => find(args).clearSide(),
    anyChat,
    undefined,
    {
      description:
        "Убирает из панели предыдущие вопросы в сторону этого чата. История чата и файлы не меняются.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.chat.status",
    "Состояние чата агента",
    (args) => find(args).status(),
    anyChat,
    undefined,
    {
      description:
        "Возвращает снимок состояния чата: занят ли агент, фаза, сколько идёт, когда было последнее событие, выполняющиеся инструменты, ожидающие разрешения и вопросы, очередь, живой процесс и сессию. Только чтение: используется вопросами в сторону, чтобы отличить ожидание пользователя от зависания.",
      arguments: { chat: CHAT },
    },
  );
}
