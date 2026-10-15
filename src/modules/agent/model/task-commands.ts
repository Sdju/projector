import { commandArgs } from "../../../common/utilities/commands.ts";
import { chatsOf, resolveChat } from "./chat-registry.ts";
import type { RegisterCommand } from "./agent-commands.ts";

/** The commands for subagents and background commands of the open chats of a project. */
export function registerTaskCommands(register: RegisterCommand, projectId: string): void {
  register(
    "ide.agent.tasks.list",
    "Задачи чата агента",
    (args) => {
      const chat = resolveChat(projectId, commandArgs(args).chat);
      return chat.tasks().map((task) => ({
        chat: chat.key,
        task: task.id,
        title: task.title,
        kind: task.kind,
        status: task.status,
        background: task.background,
        summary: task.summary,
      }));
    },
    () => chatsOf(projectId).length > 0,
    undefined,
    {
      description:
        "Возвращает субагентов и фоновые команды открытого чата: ключ чата и идентификатор задачи (для ide.workbench.agent.task.open), название, вид, состояние и итог.",
      arguments: {
        chat: "Ключ чата из ide.agent.chats.list; без него — чат, с которым работали последним",
      },
    },
  );
}
