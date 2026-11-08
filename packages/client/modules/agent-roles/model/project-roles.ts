import { computed, ref, useId } from "vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import type { AgentProjectRoleState, AgentRole } from "@projector/core/modules/agent-role/index.ts";
import {
  createProjectRole,
  readProjectRoles,
  removeProjectRole,
  setProjectRoleTrust,
  writeProjectRole,
} from "../api/project-roles.ts";

/** Roles stored in a project's `.projector/roles.json`; the file is inert until trusted. */
export function useProjectRoleSettings(projectId: () => string) {
  const data = ref<AgentProjectRoleState>();
  const busy = ref("");
  const error = ref("");
  const commands = useCommandScope(`agent-project-roles:${useId()}`, () => ({
    surface: "agentProjectRoles",
    projectId: projectId(),
    trusted: data.value?.trusted === true,
    roles: data.value?.roles.length ?? 0,
    busy: busy.value,
  }));

  const roles = computed(() => data.value?.roles ?? []);
  const trusted = computed(() => data.value?.trusted === true);
  const file = computed(() => data.value?.file ?? "");
  const exists = computed(() => data.value?.exists === true);
  const problem = computed(() => data.value?.problem ?? "");
  const message = computed(() => error.value || problem.value);

  async function perform<T>(action: () => Promise<T>): Promise<T> {
    error.value = "";
    try {
      return await action();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Ошибка ролей проекта";
      throw cause;
    }
  }

  async function load(): Promise<AgentProjectRoleState | undefined> {
    const id = projectId();
    if (!id) {
      data.value = undefined;
      return undefined;
    }
    return perform(async () => {
      data.value = await readProjectRoles(id);
      return data.value;
    });
  }

  async function trust(value: boolean): Promise<AgentProjectRoleState> {
    const id = projectId();
    busy.value = "trust";
    try {
      return await perform(async () => {
        data.value = await setProjectRoleTrust(id, value);
        return data.value;
      });
    } finally {
      busy.value = "";
    }
  }

  async function create(): Promise<AgentProjectRoleState> {
    const id = projectId();
    busy.value = "new";
    try {
      return await perform(async () => {
        data.value = await createProjectRole(id, {
          name: "Новая роль проекта",
          description: "",
          agent: "projector",
          selection: {},
        });
        return data.value;
      });
    } finally {
      busy.value = "";
    }
  }

  async function save(roleId: string, role: Partial<AgentRole>): Promise<AgentProjectRoleState> {
    const id = projectId();
    busy.value = roleId;
    try {
      return await perform(async () => {
        data.value = await writeProjectRole(id, roleId, role);
        return data.value;
      });
    } finally {
      busy.value = "";
    }
  }

  async function remove(roleId: string): Promise<AgentProjectRoleState> {
    const id = projectId();
    busy.value = roleId;
    try {
      return await perform(async () => {
        data.value = await removeProjectRole(id, roleId);
        return data.value;
      });
    } finally {
      busy.value = "";
    }
  }

  commands.scope.registerCommand({
    id: "ide.agent.projectRoles.list",
    palette: false,
    title: "Роли проекта",
    description:
      "Возвращает роли из .projector/roles.json, путь к файлу, признак доверия и ошибку чтения. Недоверенные роли не открываются в чатах, заданиях и task.",
    run: async () => {
      await load();
      return (
        data.value ?? {
          projectId: projectId(),
          path: "",
          file: "",
          exists: false,
          trusted: false,
          roles: [],
        }
      );
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.projectRoles.create",
    palette: false,
    title: "Создать роль проекта",
    description:
      "Создаёт chat-роль в .projector/roles.json. После записи файл нужно доверить заново. Роль появится в меню «+» только у доверенного файла.",
    run: () => create(),
  });
  commands.scope.registerCommand({
    id: "ide.agent.projectRoles.save",
    palette: false,
    title: "Сохранить роль проекта",
    description:
      "Меняет chat-роль в .projector/roles.json: название, агента, настройки, промпт, навыки и MCP. Не переданные поля сохраняются; пустой массив skills или mcp выключает их. Любая запись меняет хеш файла и отзывает доверие.",
    arguments: {
      role: "string: id роли проекта",
      name: "string: название",
      agent: "string: id агента",
      description: "string: описание",
      selection: "object: control id → value",
      prompt: "string: дополнительные инструкции роли",
      skills: "array: имена навыков",
      mcp: "array: имена MCP-серверов",
    },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      if (typeof args.role !== "string" || !args.role) throw new Error("role: id роли проекта");
      if (typeof args.name !== "string" || !args.name.trim()) throw new Error("name: название");
      if (typeof args.agent !== "string" || !args.agent) throw new Error("agent: id агента");
      const known = roles.value.find((role) => role.id === args.role);
      if (!known) throw new Error(`Неизвестная роль проекта: ${args.role}`);
      const names = (input: unknown, fallback: string[] | undefined) =>
        Array.isArray(input)
          ? input.filter((item): item is string => typeof item === "string")
          : fallback;
      return save(args.role, {
        ...known,
        name: args.name,
        agent: args.agent,
        description: typeof args.description === "string" ? args.description : known.description,
        selection:
          args.selection && typeof args.selection === "object" && !Array.isArray(args.selection)
            ? (args.selection as Record<string, string>)
            : known.selection,
        prompt: typeof args.prompt === "string" ? args.prompt : known.prompt,
        skills: names(args.skills, known.skills),
        mcp: names(args.mcp, known.mcp),
      });
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.projectRoles.delete",
    palette: false,
    title: "Удалить роль проекта",
    description: "Удаляет chat-роль из .projector/roles.json и отзывает доверие к файлу.",
    arguments: { role: "string: id роли проекта" },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      if (typeof args.role !== "string" || !args.role) throw new Error("role: id роли проекта");
      return remove(args.role);
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.projectRoles.trust",
    palette: false,
    title: "Доверять ролям проекта",
    description:
      "Выдаёт или отзывает доверие к текущему содержимому .projector/roles.json. Доверие привязано к хешу файла: правка файла отзывает его автоматически.",
    arguments: { trusted: "boolean: доверять ли текущему файлу" },
    enabled: () => !busy.value,
    run: (value) => {
      const trusted = commandArgs(value).trusted;
      if (typeof trusted !== "boolean") throw new Error("trusted должен быть boolean");
      return trust(trusted);
    },
  });

  return {
    data,
    roles,
    trusted,
    file,
    exists,
    problem,
    busy,
    error: message,
    load,
    trust,
    create,
    save,
    remove,
    commands,
  };
}
