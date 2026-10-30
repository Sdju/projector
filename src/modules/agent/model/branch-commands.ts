import { commandArgs } from "../../../common/utilities/commands.ts";
import { fetchRecentChats } from "../api/chats.ts";
import { chatTabCommand } from "../lib/chat-tab.ts";
import type { RegisterCommand } from "./register-command.ts";
import type { ForkMode } from "./branches.ts";
import { chatsOf, resolveChat, type ChatController } from "./chat-registry.ts";

const CHAT = "Ключ чата из ide.agent.chats.list; без него — чат, с которым работали последним";

function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new Error(`Укажите ${key}`);
  return value;
}

/** Branches of a chat and the list of chats a closed tab can be brought back from. */
export function registerBranchCommands(register: RegisterCommand, projectId: string): void {
  const idle = () => chatsOf(projectId).some((chat) => !chat.busy());
  const find = (args: unknown, accept?: (chat: ChatController) => boolean) =>
    resolveChat(projectId, commandArgs(args).chat, accept);

  register(
    "ide.agent.chats.recent",
    "Недавние чаты проекта",
    () =>
      fetchRecentChats(projectId).then((chats) =>
        chats.map((item) => ({
          ...item,
          open: chatTabCommand(projectId, item.chat, item.title) ?? null,
        })),
      ),
    () => true,
    undefined,
    {
      description:
        "Возвращает чаты агентов проекта, сохранённые на диске, включая закрытые вкладки: ключ, агент, название, время и команда открытия (open: { command, args }; null — если вкладки у чата нет). Позволяет вернуться к ветке после закрытия её вкладки.",
    },
  );
  register(
    "ide.agent.chat.fork",
    "Ответвить чат в новый",
    async (args) => {
      const options = commandArgs(args);
      const chat = find(args, (item) => !item.busy());
      const turnId = text(options, "turnId");
      const asked = options.mode;
      if (asked !== undefined && asked !== "before" && asked !== "after")
        throw new Error("mode: before или after");
      const role = chat.turns().find((turn) => turn.id === turnId)?.role;
      const mode: ForkMode = asked ?? (role === "assistant" ? "after" : "before");
      return chat.fork(turnId, mode);
    },
    idle,
    undefined,
    {
      description:
        "Создаёт новую ветку разговора в отдельном чате, не меняя текущий. mode: before — копия разговора до сообщения пользователя, его текст остаётся в поле ввода новой ветки; after — копия включая ответ, ветка продолжает с этого места. Открывает вкладку ветки и возвращает её ключ. Файлы не откатываются, изолированная копия проекта у веток общая.",
      arguments: {
        turnId: "Сообщение из ide.agent.turns.list",
        mode: "before | after; по умолчанию before для вопроса и after для ответа",
        chat: CHAT,
      },
    },
  );
}
