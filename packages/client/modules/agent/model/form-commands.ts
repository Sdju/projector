import { commandArgs } from "../../../common/utilities/commands.ts";
import { chatsOf, resolveChat } from "../../agent-core/index.ts";
import type { RegisterCommand } from "../../agent-core/index.ts";

const CHAT = "Ключ чата из ide.agent.chats.list; без него — чат, с которым работали последним";

/** The form that replaced the composer: the user answers it, these commands only show or hide it. */
export function registerFormCommands(register: RegisterCommand, projectId: string) {
  const hasForm = () => chatsOf(projectId).some((chat) => !chat.busy() && !!chat.pendingForm());
  const find = (args: unknown) =>
    resolveChat(projectId, commandArgs(args).chat, (chat) => !!chat.pendingForm());

  register(
    "ide.agent.form.show",
    "Показать форму ответа в поле ввода",
    (args) => {
      find(args).showForm();
      return { shown: true };
    },
    hasForm,
    undefined,
    {
      description:
        "Возвращает в поле ввода форму, которой закончился последний ответ. Форму заполняет пользователь; команда только показывает её и ничего не отправляет.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.form.text",
    "Вернуть текстовое поле вместо формы",
    (args) => {
      find(args).hideForm();
      return { text: true };
    },
    hasForm,
    undefined,
    {
      description:
        "Убирает форму из поля ввода и возвращает обычное текстовое поле. Сама форма остаётся в ответе; ide.agent.form.show вернёт её.",
      arguments: { chat: CHAT },
    },
  );
}
