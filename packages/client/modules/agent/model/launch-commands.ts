import {
  parseAgentLaunchOverride,
  type AgentLaunchOverride,
} from "@ai-projector/core/modules/agent-launch/index.ts";
import { commandArgs } from "../../../common/utilities/commands.ts";
import type { RegisterCommand } from "../../agent-core/index.ts";
import { readAgentLaunch, resetAgentLaunch, writeAgentLaunch } from "../modules/settings/index.ts";

function backendOf(args: Record<string, unknown>): string {
  if (typeof args.backend !== "string" || !args.backend.trim())
    throw new Error("backend: идентификатор ACP-агента");
  return args.backend.trim();
}

function overrideOf(args: Record<string, unknown>): AgentLaunchOverride {
  const raw = {
    ...(args.command !== undefined ? { command: args.command } : {}),
    ...(args.args !== undefined ? { args: args.args } : {}),
    ...(args.env !== undefined ? { env: args.env } : {}),
  };
  return parseAgentLaunchOverride(raw) ?? {};
}

/**
 * Machine-local ACP launch settings from a chat. The same actions are registered by the settings
 * page; these live with the project workspace, so an agent can change another computer's launch
 * without opening that page.
 */
export function registerLaunchCommands(register: RegisterCommand): void {
  register(
    "ide.agent.launch.list",
    "Настройки запуска ACP-агентов",
    () => readAgentLaunch(),
    () => true,
    undefined,
    {
      description:
        "Возвращает машинные переопределения запуска ACP-агентов: значения по умолчанию, сохранённую команду, аргументы, окружение, итоговый запуск и найденный путь.",
    },
  );
  register(
    "ide.agent.launch.set",
    "Изменить запуск ACP-агента",
    (value) => {
      const args = commandArgs(value);
      return writeAgentLaunch(backendOf(args), overrideOf(args));
    },
    () => true,
    undefined,
    {
      description:
        "Заменяет команду, аргументы и переменные окружения запуска ACP-агента только на этой машине. Пустой объект возвращает значения агента. Аргументы передаются массивом, а не строкой для shell.",
      arguments: {
        backend: "string: идентификатор ACP-агента",
        command: "string: исполняемый файл или имя в PATH; пусто — из дескриптора",
        args: "string[]: аргументы команды",
        env: "object: переменные окружения KEY=value",
      },
    },
  );
  register(
    "ide.agent.launch.reset",
    "Вернуть запуск ACP-агента по умолчанию",
    (value) => resetAgentLaunch(backendOf(commandArgs(value))),
    () => true,
    undefined,
    {
      description: "Удаляет машинное переопределение команды ACP-агента.",
      arguments: { backend: "string: идентификатор ACP-агента" },
    },
  );
  register(
    "ide.agent.launch.check",
    "Проверить запуск ACP-агента",
    async (value) => {
      const backend = backendOf(commandArgs(value));
      const state = await readAgentLaunch();
      return state.agents.find((agent) => agent.id === backend);
    },
    () => true,
    undefined,
    {
      description:
        "Перечитывает файл запуска и возвращает итоговую команду и найденный путь одного ACP-агента.",
      arguments: { backend: "string: идентификатор ACP-агента" },
    },
  );
}
