import type { createCommandService } from "../../../../core/modules/ide/index.ts";
import type { AgentCommandRequest } from "./types.ts";

export function agentCommandHandler(
  api: ReturnType<typeof createCommandService>,
  projectId: string,
) {
  return async (request: AgentCommandRequest): Promise<unknown> => {
    const scopes = api
      .getScopes()
      .filter(
        ({ context }) =>
          context.projectId === projectId ||
          (context.projectId === undefined &&
            ["workbench", "keybindings", "settings"].includes(String(context.surface))),
      );
    const allowed = new Set(scopes.map(({ id }) => id));
    if (request.operation === "list") {
      const query = (request.query ?? "").toLocaleLowerCase();
      return {
        scopes,
        commands: api
          .getCommands()
          .filter(
            (command) =>
              allowed.has(command.scope) &&
              `${command.id} ${command.title} ${command.description}`
                .toLocaleLowerCase()
                .includes(query),
          )
          .map(({ id, title, scope, enabled }) => ({ id, title, scope, enabled })),
      };
    }
    if (!request.scope || !allowed.has(request.scope))
      throw new Error("Область недоступна в текущем проекте");
    if (!request.command) throw new Error("Укажите ID команды");
    const command = api.describeCommand(request.scope, request.command, request.args);
    if (!command) throw new Error("Команда не зарегистрирована");
    if (request.operation === "describe")
      return {
        ...command,
        context: scopes.find(({ id }) => id === request.scope)!.context,
      };
    if (request.operation !== "execute") throw new Error("Неизвестная операция");
    return (
      (await api.executeCommand(request.command, request.args, { scope: request.scope })) ?? {
        completed: true,
      }
    );
  };
}
