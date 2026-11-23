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
} from "@ai-projector/core/modules/agent-role/index.ts";
import { clientAgents } from "../../agents-integration/catalog/index.ts";
import { useCommandScope } from "../../../common/utilities/commands.ts";
import { readProjectRoles } from "../api/project-roles.ts";
import { registerRoleSettingsCommands } from "./role-settings-commands.ts";
import {
  hasMediaRole,
  listener,
  loadListener,
  loadRoleMediaModels,
  mediaModelOf,
  mediaOptionsFor,
} from "./role-media.ts";
import { firstProjectId, readControls, type RoleControl } from "./controls.ts";
export type { RoleMediaOption } from "./role-media.ts";
export {
  listener,
  loadListener,
  loadRoleMediaModels,
  mediaModelOf,
  mediaOptionsFor,
} from "./role-media.ts";
export type { RoleControl, RoleControlOption } from "./controls.ts";

/** Where a chat role in the launcher came from: user settings or the trusted project file. */
export type ChatRoleSource = "global" | "project";
export type ChatRoleListItem = AgentRoleView & { source: ChatRoleSource };

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
export async function loadChatRoles(projectId: string): Promise<ChatRoleListItem[]> {
  const [data, project] = await Promise.all([
    readAgentRoles(),
    projectId ? readProjectRoles(projectId).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const roles = new Map<string, ChatRoleListItem>(
    data.roles
      .filter((role) => role.kind === "chat")
      .map((role) => [role.id, { ...role, source: "global" as const }]),
  );
  for (const role of project?.trusted ? project.roles : [])
    if (role.kind === "chat") roles.set(role.id, { ...role, source: "project" });
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
      if (hasMediaRole(data.roles)) {
        await loadRoleMediaModels(true).catch((cause) => {
          error.value = cause instanceof Error ? cause.message : "Не удалось получить медиа-модели";
        });
        await loadListener().catch(() => undefined);
      }
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

  async function setService(
    role: string,
    provider: string,
    prompt?: string,
  ): Promise<AgentRoleSettings> {
    const known = state.data.roles.find((item) => item.id === role && item.kind === "service");
    if (!known) throw new Error(`Неизвестная служебная роль: ${role}`);
    const selection: AgentRoleSelection = provider.trim() ? { provider: provider.trim() } : {};
    busy.value = role;
    try {
      return await perform(async () => {
        const data = await writeServiceRole(
          role,
          selection,
          known.media && prompt === undefined ? known.prompt : prompt,
        );
        applyAgentRoles(data);
        await loadListener().catch(() => undefined);
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
        await loadListener().catch(() => undefined);
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

  registerRoleSettingsCommands({
    commands,
    busy,
    chatRoles,
    listener,
    loadRoles: loadAgentRoles,
    loadListener,
    setService,
    resetService,
    createChat,
    saveChat,
    removeChat,
  });

  return {
    roles,
    serviceRoles,
    chatRoles,
    agents,
    file,
    modelOptions,
    controlsFor: roleControls,
    mediaOptionsFor,
    mediaModelOf,
    listener,
    loadListener,
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
