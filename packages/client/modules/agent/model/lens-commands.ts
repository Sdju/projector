import { commandArgs } from "../../../common/utilities/commands.ts";
import { chatsOf, resolveChat } from "./chat-registry.ts";
import type { RegisterCommand } from "./register-command.ts";

const CHAT = "Ключ чата из ide.agent.chats.list; без него — чат, с которым работали последним";

/**
 * Lens: a short caption of what the agent is doing now, shown in the work block. It reads the
 * visible chat and the live state, asks the chat's own model and writes nothing anywhere.
 */
export function registerLensCommands(register: RegisterCommand, projectId: string): void {
  const hasTurns = () => chatsOf(projectId).some((chat) => chat.turns().length > 0);
  const find = (args: unknown) => resolveChat(projectId, commandArgs(args).chat);

  register(
    "ide.agent.lens.show",
    "Показать Lens: чем агент занят",
    async (args) => ({ open: true, text: await find(args).openLens() }),
    hasTurns,
    undefined,
    {
      description:
        "Включает Lens в блоке работы последнего ответа и возвращает короткую сводку: чем агент занят сейчас, по видимой переписке и состоянию чата. Ничего не пишет в историю, не прерывает агента и не создаёт запуск. Дальше Lens обновляется по таймеру, пока агент работает, и по ide.agent.lens.refresh.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.lens.hide",
    "Скрыть Lens",
    (args) => {
      find(args).closeLens();
      return { open: false };
    },
    hasTurns,
    undefined,
    {
      description: "Выключает Lens в этом чате и отменяет запрос сводки, если он ещё идёт.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.lens.refresh",
    "Обновить Lens",
    async (args) => ({ text: await find(args).refreshLens() }),
    hasTurns,
    undefined,
    {
      description:
        "Просит новую сводку о текущей работе и ждёт её. Работает и во время ответа агента; прежняя сводка остаётся, пока не придёт новая.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.lens.auto",
    "Автообновление Lens",
    (args) => {
      const value = commandArgs(args).enabled;
      if (typeof value !== "boolean") throw new Error("enabled должен быть boolean");
      const chat = find(args);
      chat.setLensAuto(value);
      return { open: chat.lensOpen(), auto: value };
    },
    hasTurns,
    undefined,
    {
      description:
        "Включает или выключает автообновление Lens по таймеру, пока агент занят. Ручной ide.agent.lens.refresh работает в любом случае.",
      arguments: { enabled: "boolean: обновлять автоматически", chat: CHAT },
    },
  );
}
