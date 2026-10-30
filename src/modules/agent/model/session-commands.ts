import { commandArgs } from "../../../common/utilities/commands.ts";
import { chatsOf, resolveChat, type ChatController } from "./chat-registry.ts";
import { isBuiltinAgent } from "./modes.ts";
import type { RegisterCommand } from "./register-command.ts";

const CHAT = "Ключ чата из ide.agent.chats.list; без него — чат, с которым работали последним";
const deletable = (chat: ChatController) =>
  isBuiltinAgent(chat.backend) || !!chat.capabilities().deleteSessions;

/** The command that removes a past session of an open chat's agent. */
export function registerSessionCommands(register: RegisterCommand, projectId: string): void {
  register(
    "ide.agent.session.delete",
    "Удалить прошлую сессию агента",
    async (args) => {
      const options = commandArgs(args);
      const sessionId = options.sessionId;
      if (typeof sessionId !== "string" || !sessionId) throw new Error("Укажите sessionId");
      if (options.confirm !== true) throw new Error("Удаление необратимо: передайте confirm: true");
      await resolveChat(projectId, options.chat, deletable).removeSession(sessionId);
      return { sessionId };
    },
    () => chatsOf(projectId).some(deletable),
    undefined,
    {
      description:
        "Навсегда удаляет прошлую сессию (историю чата) агента открытого чата; восстановить её нельзя, поэтому нужен confirm: true. Идентификаторы даёт ide.agent.sessions.list. Не все внешние агенты умеют удалять сессии.",
      arguments: { sessionId: "Идентификатор сессии", confirm: "true — подтверждение", chat: CHAT },
    },
  );
}
