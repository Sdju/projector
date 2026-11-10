import { computed, reactive, ref, useId } from "vue";
import {
  createChatRole,
  readAgentRoles,
  removeChatRole,
  resetServiceRole,
  writeChatRole,
  writeServiceRole,
  type AgentRoleSettings,
} from "../api/roles.ts";
import type {
  AgentRole,
  AgentRoleSelection,
  AgentRoleView,
} from "@projector-ai/core/modules/agent-role/index.ts";
import { clientAgents } from "../../agents-integration/catalog/index.ts";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { readProjectRoles } from "../api/project-roles.ts";
import { firstProjectId, readControls, type RoleControl } from "./controls.ts";
export type { RoleControl, RoleControlOption } from "./controls.ts";

/**
 * The service roles and the user's chat roles. The catalog is shared by the settings, the new
 * session menu and the commands: a role saved in one place is seen by the others without a reload.
 */
const state = reactive({
  data: { roles: [], file: "" } as AgentRoleSettings,
  /** Projector's own controls, reused by service cards and chat roles on that backend. */
  controls: [] as RoleControl[],
  loaded: false,
  error: "",
});
const controlsByAgent = new Map<string, RoleControl[]>();
let loading: Promise<AgentRoleSettings> | undefined;
let controlsLoading: Promise<RoleControl[]> | undefined;

/** Wraps a server response so a mocked or older response cannot leave the catalog undefined. */
function settingsOf(data: AgentRoleSettings): AgentRoleSettings {
  return {
    roles: Array.isArray(data?.roles) ? data.roles : [],
    file: typeof data?.file === "string" ? data.file : "",
    ...(data?.created ? { created: data.created } : {}),
  };
}

export async function loadAgentRoles(force = false): Promise<AgentRoleSettings> {
  if (state.loaded && !force) return state.data;
  if (loading) return loading;
  loading = readAgentRoles()
    .then((data) => {
      state.data = settingsOf(data);
      state.loaded = true;
      state.error = "";
      return state.data;
    })
    .catch((error) => {
      state.error = error instanceof Error ? error.message : "Ошибка ролей агентов";
      throw error;
    })
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

/** Projector's controls, needed by the settings; the role launcher works without them. */
export async function loadAgentRoleControls(force = false): Promise<RoleControl[]> {
  if (state.controls.length && !force) return state.controls;
  if (controlsLoading) return controlsLoading;
  controlsLoading = readControls("projector", "")
    .then((controls) => {
      state.controls = controls;
      controlsByAgent.set("projector", controls);
      return controls;
    })
    .finally(() => {
      controlsLoading = undefined;
    });
  return controlsLoading;
}

/** Applies a response that already carries the whole state (a saved role or a reset). */
export function applyAgentRoles(data: AgentRoleSettings): void {
  state.data = settingsOf(data);
  state.loaded = true;
  state.error = "";
}

/** Chat roles of the current project: trusted project roles override global roles with the same id. */
export async function loadChatRoles(projectId: string): Promise<AgentRoleView[]> {
  const [data, project] = await Promise.all([
    readAgentRoles(),
    projectId ? readProjectRoles(projectId).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const roles = new Map(
    data.roles.filter((role) => role.kind === "chat").map((role) => [role.id, role] as const),
  );
  for (const role of project?.trusted ? project.roles : [])
    if (role.kind === "chat") roles.set(role.id, role);
  return [...roles.values()];
}

/** The controls an agent offers for a preset; external agents are read in the first project. */
export async function roleControls(agent: string): Promise<RoleControl[]> {
  if (agent === "projector") return loadAgentRoleControls();
  const known = controlsByAgent.get(agent);
  if (known) return known;
  const offered = await readControls(agent, await firstProjectId());
  controlsByAgent.set(agent, offered);
  return offered;
}

export function useAgentRoleSettings() {
  const busy = ref("");
  const error = ref("");
  const commands = useCommandScope(`agent-roles:${useId()}`, () => ({
    surface: "agentRoles",
    busy: busy.value,
    roles: state.data.roles.length,
  }));

  /** The provider/model control the Projector agent offers; service roles use only its values. */
  const modelControl = computed(() => {
    const projector = controlsByAgent.get("projector") ?? state.controls;
    return projector.find((control) => control.id === "provider");
  });
  const modelOptions = computed(() => modelControl.value?.options ?? []);
  const roles = computed(() => state.data.roles);
  const serviceRoles = computed(() => state.data.roles.filter((role) => role.kind === "service"));
  const chatRoles = computed(() => state.data.roles.filter((role) => role.kind === "chat"));
  const agents = computed(() => clientAgents());
  const file = computed(() => state.data.file);
  const message = computed(() => error.value || state.error);

  async function reload(): Promise<AgentRoleSettings> {
    error.value = "";
    try {
      const data = await loadAgentRoles(true);
      // The roles are usable without the model list; a provider failure only disables the picker.
      await loadAgentRoleControls(true).catch((cause) => {
        error.value =
          cause instanceof Error ? cause.message : "Не удалось получить модели провайдеров";
      });
      return data;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Ошибка ролей агентов";
      throw cause;
    }
  }

  async function perform<T>(action: () => Promise<T>): Promise<T> {
    error.value = "";
    try {
      return await action();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Не удалось сохранить роль";
      throw cause;
    }
  }

  async function setService(role: string, provider: string): Promise<AgentRoleSettings> {
    const known = state.data.roles.find((item) => item.id === role && item.kind === "service");
    if (!known) throw new Error(`Неизвестная служебная роль: ${role}`);
    const selection: AgentRoleSelection = provider.trim() ? { provider: provider.trim() } : {};
    busy.value = role;
    try {
      return await perform(async () => {
        const data = await writeServiceRole(role, selection);
        applyAgentRoles(data);
        return data;
      });
    } finally {
      busy.value = "";
    }
  }

  async function resetService(role: string): Promise<AgentRoleSettings> {
    const known = state.data.roles.find((item) => item.id === role && item.kind === "service");
    if (!known) throw new Error(`Неизвестная служебная роль: ${role}`);
    busy.value = role;
    try {
      return await perform(async () => {
        const data = await resetServiceRole(role);
        applyAgentRoles(data);
        return data;
      });
    } finally {
      busy.value = "";
    }
  }

  async function createChat(): Promise<AgentRoleView> {
    busy.value = "new";
    try {
      return await perform(async () => {
        const data = await createChatRole({
          name: "Новая роль",
          description: "",
          agent: "projector",
          selection: {},
        });
        applyAgentRoles(data);
        const created = data.created ?? data.roles.findLast((role) => role.kind === "chat");
        if (!created) throw new Error("Роль не создана");
        return created;
      });
    } finally {
      busy.value = "";
    }
  }

  async function saveChat(id: string, role: Partial<AgentRole>): Promise<AgentRoleSettings> {
    const known = state.data.roles.find((item) => item.id === id && item.kind === "chat");
    if (!known) throw new Error(`Неизвестная роль: ${id}`);
    busy.value = id;
    try {
      return await perform(async () => {
        const data = await writeChatRole(id, role);
        applyAgentRoles(data);
        return data;
      });
    } finally {
      busy.value = "";
    }
  }

  async function removeChat(id: string): Promise<AgentRoleSettings> {
    const known = state.data.roles.find((item) => item.id === id && item.kind === "chat");
    if (!known) throw new Error(`Неизвестная роль: ${id}`);
    busy.value = id;
    try {
      return await perform(async () => {
        const data = await removeChatRole(id);
        applyAgentRoles(data);
        return data;
      });
    } finally {
      busy.value = "";
    }
  }

  commands.scope.registerCommand({
    id: "ide.agent.roles.list",
    palette: false,
    title: "Список ролей агентов",
    description:
      "Возвращает служебные роли (Доктор, Lens, Судья) и chat-роли: id, название, агента, выбранные настройки и наследуется ли модель. Служебные роли — внутренние вызовы без инструментов; chat-роль открывает обычный чат.",
    run: async () => {
      const data = await loadAgentRoles();
      return {
        file: data.file,
        roles: data.roles.map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          kind: role.kind,
          agent: role.agent,
          selection: role.selection,
          prompt: role.prompt,
          skills: role.skills,
          mcp: role.mcp,
          inherited: role.inherited,
        })),
      };
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.roles.set",
    palette: false,
    title: "Выбрать модель служебной роли",
    description:
      "Задаёт модель для служебной роли Projector. provider — значение из ide.agent.roles.list, например provider:model; пустая строка возвращает роль к модели чата. Это меняет только внутренние вызовы Доктора, Lens или Судьи: промпты, отсутствие инструментов и лимиты остаются прежними.",
    arguments: {
      role: "string: id служебной роли: doctor, lens или judge",
      provider: "string: provider:model из настроек провайдеров; пустая строка — как в чате",
    },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      if (typeof args.role !== "string" || !args.role)
        throw new Error("role: id служебной роли: doctor, lens или judge");
      if (typeof args.provider !== "string")
        throw new Error("provider: строка provider:model или пустая строка");
      return setService(args.role, args.provider);
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.roles.reset",
    palette: false,
    title: "Вернуть служебной роли модель чата",
    description:
      "Удаляет выбранную модель роли. Доктор, Lens или Судья снова используют модель текущего чата или активного провайдера.",
    arguments: { role: "string: id служебной роли: doctor, lens или judge" },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      if (typeof args.role !== "string" || !args.role)
        throw new Error("role: id служебной роли: doctor, lens или judge");
      return resetService(args.role);
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.roles.create",
    palette: false,
    title: "Создать chat-роль",
    description:
      "Создаёт новую роль для чата с именем «Новая роль» и агентом Projector. Дальше её настройки меняет ide.agent.roles.save: название, агент и набор controls. Возвращает созданную роль.",
    run: () => createChat(),
  });
  commands.scope.registerCommand({
    id: "ide.agent.roles.save",
    palette: false,
    title: "Сохранить chat-роль",
    description:
      "Меняет название, описание, агента, выбранные настройки, промпт, навыки и MCP chat-роли. selection — объект control id → value; отсутствующее значение наследует умолчание агента. prompt добавляется к системному промпту; skills и mcp — имена, пустой массив выключает их. Не переданные поля сохраняются. Роль действует на новые чаты; уже начатые чаты сохраняют снимок.",
    arguments: {
      role: "string: id chat-роли",
      name: "string: название роли",
      agent: "string: id агента из каталога",
      description: "string: описание (необязательно)",
      selection: "object: control id → value (необязательно)",
      prompt: "string: дополнительные инструкции роли (необязательно)",
      skills: "array: имена навыков; пустой массив выключает (необязательно)",
      mcp: "array: имена MCP-серверов; пустой массив выключает (необязательно)",
    },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      if (typeof args.role !== "string" || !args.role) throw new Error("role: id chat-роли");
      if (typeof args.name !== "string" || !args.name.trim())
        throw new Error("name: название роли");
      if (typeof args.agent !== "string" || !args.agent) throw new Error("agent: id агента");
      const known = chatRoles.value.find((role) => role.id === args.role);
      if (!known) throw new Error(`Неизвестная chat-роль: ${args.role}`);
      const selection =
        args.selection && typeof args.selection === "object" && !Array.isArray(args.selection)
          ? (args.selection as AgentRoleSelection)
          : known.selection;
      const names = (input: unknown, fallback: string[] | undefined) =>
        Array.isArray(input)
          ? input.filter((item): item is string => typeof item === "string")
          : fallback;
      return saveChat(args.role, {
        ...known,
        name: args.name,
        agent: args.agent,
        description: typeof args.description === "string" ? args.description : known.description,
        selection,
        prompt: typeof args.prompt === "string" ? args.prompt : known.prompt,
        skills: names(args.skills, known.skills),
        mcp: names(args.mcp, known.mcp),
      });
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.roles.delete",
    palette: false,
    title: "Удалить chat-роль",
    description:
      "Удаляет chat-роль. Уже начатые чаты продолжают работать со своим снимком; роль перестаёт появляться в меню новой сессии.",
    arguments: { role: "string: id chat-роли" },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      if (typeof args.role !== "string" || !args.role) throw new Error("role: id chat-роли");
      return removeChat(args.role);
    },
  });

  return {
    roles,
    serviceRoles,
    chatRoles,
    agents,
    file,
    modelOptions,
    controlsFor: roleControls,
    busy,
    error: message,
    load: reload,
    setService,
    resetService,
    createChat,
    saveChat,
    removeChat,
    commands,
  };
}
