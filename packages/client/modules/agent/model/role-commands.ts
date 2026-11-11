import { getCurrentInstance } from "vue";
import { newId } from "../../../common/utilities/new-id.ts";
import { commandArgs } from "../../../common/utilities/commands.ts";
import { clientAgentByBackend } from "../../agents-integration/catalog/index.ts";
import { focusedRoleId, loadChatRoles } from "../../agent-roles/index.ts";
import { roleParam } from "../../agent-core/index.ts";
import { useIdeCommands } from "../../ide/index.ts";
import { snapshotOfRole } from "@ai-projector/core/modules/agent-role/index.ts";
import type { RegisterCommand } from "../../agent-core/index.ts";
import { appSettingsSection } from "../../settings/index.ts";
import { projectSettingsSection } from "../../catalog/index.ts";

/** The part of the IDE command service a role launch needs: opening the chat tab. */
interface RoleCommands {
  executeCommand(id: string, args?: unknown, options?: { scope?: string }): Promise<unknown>;
}

/**
 * Roles are opened from the workspace, not from a chat: the command survives tabs and knows how
 * to turn a role into the chat tab of its agent with a snapshot of the settings.
 */
export function registerRoleCommands(
  register: RegisterCommand,
  projectId: string,
  api: RoleCommands | undefined = getCurrentInstance() ? useIdeCommands().api : undefined,
): void {
  register(
    "ide.agent.roles.chat.list",
    "Роли агентов для чата",
    async () => {
      const roles = await loadChatRoles(projectId);
      return {
        roles: roles.map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          agent: role.agent,
          selection: role.selection,
          prompt: role.prompt,
          skills: role.skills,
          mcp: role.mcp,
          inherited: role.inherited,
          source: role.source,
        })),
      };
    },
    () => true,
    undefined,
    {
      description:
        "Возвращает chat-роли, которые можно открыть командой ide.agent.role.open или править ide.agent.role.edit: id, название, агент, настройки и source (global или project). Служебные роли (Доктор, Lens, Судья) сюда не входят — они не открывают чат.",
    },
  );
  register(
    "ide.agent.role.open",
    "Открыть чат с ролью",
    async (args) => {
      const id = commandArgs(args).role;
      if (typeof id !== "string" || !id) throw new Error("role: id chat-роли");
      const roles = await loadChatRoles(projectId);
      const role = roles.find((item) => item.id === id);
      if (!role) throw new Error(`Неизвестная chat-роль: ${id}`);
      const agent = clientAgentByBackend(role.agent);
      if (!agent) throw new Error(`Агент роли не найден: ${role.agent}`);
      if (!api) throw new Error("Роли открываются только в рабочей области проекта");
      const tab = agent.builtin ? "agent" : agent.program;
      const chatId = newId();
      const command = `ide.workbench.${tab}.open`;
      await api.executeCommand(
        command,
        { chatId, role: roleParam(snapshotOfRole(role)) },
        { scope: `editor:${projectId}` },
      );
      return {
        role: role.id,
        name: role.name,
        agent: role.agent,
        chatId,
        command,
      };
    },
    () => true,
    undefined,
    {
      description:
        "Открывает новый чат с chat-ролью: агент роли, её модель и настройки применяются к новому разговору и сохраняются в его истории. Правка роли позже не меняет уже открытый чат. Идентификаторы ролей даёт ide.agent.roles.chat.list.",
      arguments: { role: "id chat-роли из ide.agent.roles.chat.list" },
    },
  );
  register(
    "ide.agent.role.edit",
    "Редактировать роль",
    async (args) => {
      const id = commandArgs(args).role;
      if (typeof id !== "string" || !id) throw new Error("role: id chat-роли");
      const roles = await loadChatRoles(projectId);
      const role = roles.find((item) => item.id === id);
      if (!role) throw new Error(`Неизвестная chat-роль: ${id}`);
      if (!api) throw new Error("Роли открываются только в рабочей области проекта");
      focusedRoleId.value = role.id;
      if (role.source === "project") {
        projectSettingsSection.value = "roles";
        await api.executeCommand("ide.workbench.project.settings.open", undefined, {
          scope: `editor:${projectId}`,
        });
      } else {
        appSettingsSection.value = "agent-roles";
        await api.executeCommand("ide.workbench.settings.open", undefined, {
          scope: `editor:${projectId}`,
        });
      }
      return {
        role: role.id,
        name: role.name,
        source: role.source,
        command:
          role.source === "project"
            ? "ide.workbench.project.settings.open"
            : "ide.workbench.settings.open",
      };
    },
    () => true,
    undefined,
    {
      description:
        "Открывает редактор chat-роли: глобальная роль — раздел «Роли агентов» в настройках Projector, роль проекта — раздел «Роли проекта» в настройках проекта. Правка не меняет уже открытые чаты. Идентификаторы даёт ide.agent.roles.chat.list.",
      arguments: { role: "id chat-роли из ide.agent.roles.chat.list" },
    },
  );
}
