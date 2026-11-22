import { commandArgs, type CommandScope } from "../../common/utilities/commands.ts";
import {
  checkAppUpdateNow,
  copyUpdateCommand,
  dismissAppUpdateNow,
  useAppUpdate,
} from "./model.ts";

/** Available without the About page: inbox, palette and the agent can check or copy the command. */
export function registerAppUpdateCommands(scope: CommandScope): void {
  const { busy, offer, inbox, command } = useAppUpdate();
  scope.registerCommand({
    id: "ide.app.update.check",
    title: "Проверить обновление Projector",
    description:
      "Спрашивает npm registry, есть ли более новый @ai-projector/ide с dist.tarball и integrity. Не ставит пакет и не перезапускает сервер.",
    enabled: () => !busy.value,
    run: () => checkAppUpdateNow(),
  });
  scope.registerCommand({
    id: "ide.app.update.copyCommand",
    title: "Скопировать команду обновления npm",
    description:
      "Копирует npm install -g с точной версией и --allow-scripts. После команды нужен projector restart: он завершит терминалы и ходы агентов. В checkout команда не предлагается.",
    enabled: () => !busy.value && !!command.value,
    run: async () => {
      const value = await copyUpdateCommand();
      return { command: value };
    },
  });
  scope.registerCommand({
    id: "ide.app.update.dismiss",
    title: "Не напоминать об этой версии Projector",
    description: "Скрывает inbox-уведомление для текущей latest. Следующая версия снова напомнит.",
    arguments: { version: "string: semver latest, иначе текущая из снимка" },
    enabled: () => !busy.value && (inbox.value || offer.value),
    run: (value) => {
      const { version } = commandArgs(value);
      if (version !== undefined && typeof version !== "string")
        throw new Error("version — строка semver");
      return dismissAppUpdateNow(version);
    },
  });
}
