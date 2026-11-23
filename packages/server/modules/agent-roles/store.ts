import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  BUILTIN_SERVICE_ROLES,
  MEDIA_ROLE_CONTEXT_LIMIT,
  SERVICE_ROLE_IDS,
  isServiceRoleId,
  normalizeAgentRole,
  normalizeRoleSelection,
  serviceRoleInheritsModel,
  serviceRoleMedia,
  type AgentRole,
  type AgentRoleSelection,
  type AgentRoleView,
  type ServiceRoleId,
} from "@ai-projector/core/modules/agent-role/index.ts";
import { setAsideBroken, writeFileAtomic, withFileLock } from "../atomic-files/index.ts";
import { projectRoleState } from "./project.ts";

/** The user's choices for the built-in service roles: `$XDG_DATA_HOME/projector/agent/roles.json`. */
export const rolesFile = () => join(dataDir(), "agent", "roles.json");

/** What the settings keep for a built-in role: its model and, for media roles, its context. */
interface ServiceRoleOverride {
  selection: AgentRoleSelection;
  prompt?: string;
}

interface StoredRoles {
  version: 1;
  /** User-created chat roles. Service roles are defined by the code and stored as overrides. */
  roles: AgentRole[];
  builtins: Partial<Record<ServiceRoleId, ServiceRoleOverride>>;
}

export interface AgentRoleSettings {
  roles: AgentRoleView[];
  file: string;
  /** The role a create request just added, so the page can open its editor. */
  created?: AgentRoleView;
}

const empty = (): StoredRoles => ({ version: 1, roles: [], builtins: {} });

/** Reads only the fields this version understands; malformed JSON is left to `readState`. */
function stateOf(text: string): StoredRoles {
  const data = JSON.parse(text) as { roles?: unknown; builtins?: unknown };
  const roles: AgentRole[] = [];
  if (Array.isArray(data?.roles))
    for (const item of data.roles) {
      const role = normalizeAgentRole(item);
      if (!role || role.kind !== "chat" || isServiceRoleId(role.id)) continue;
      if (roles.some((known) => known.id === role.id)) continue;
      roles.push(role);
    }
  const builtins: StoredRoles["builtins"] = {};
  if (data?.builtins && typeof data.builtins === "object" && !Array.isArray(data.builtins))
    for (const id of SERVICE_ROLE_IDS) {
      const row = (data.builtins as Record<string, unknown>)[id];
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const selection = normalizeRoleSelection((row as { selection?: unknown }).selection);
      const prompt = serviceRoleMedia(id) ? serviceRolePromptOf(row) : undefined;
      if (Object.keys(selection).length || prompt)
        builtins[id] = { selection, ...(prompt ? { prompt } : {}) };
    }
  return { version: 1, roles, builtins };
}

/** The context a media role keeps: trimmed, single-line breaks preserved, bounded. */
function serviceRolePromptOf(value: unknown): string | undefined {
  const raw = typeof value === "string" ? value : (value as { prompt?: unknown })?.prompt;
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  return text ? text.slice(0, MEDIA_ROLE_CONTEXT_LIMIT) : undefined;
}

async function readState(): Promise<StoredRoles> {
  try {
    return stateOf(await readFile(rolesFile(), "utf8"));
  } catch (error) {
    // A broken file is kept next to the settings instead of being silently overwritten.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") await setAsideBroken(rolesFile());
    return empty();
  }
}

/** Writes through a temporary file, with the owner-only mode secrets-adjacent settings use. */
async function writeState(state: StoredRoles): Promise<void> {
  await writeFileAtomic(rolesFile(), `${JSON.stringify(state, null, 2)}\n`);
}

function serviceRoleView(role: AgentRole, stored?: ServiceRoleOverride): AgentRoleView {
  const selection = stored?.selection ?? {};
  return {
    ...role,
    selection,
    ...(stored?.prompt ? { prompt: stored.prompt } : {}),
    inherited: serviceRoleInheritsModel({ selection }),
  };
}

function chatRoleView(role: AgentRole): AgentRoleView {
  return { ...role, inherited: false };
}

/** The built-in service roles and the user's chat roles, in one list for the settings. */
export async function roleSettings(): Promise<AgentRoleSettings> {
  const state = await readState();
  return {
    roles: [
      ...BUILTIN_SERVICE_ROLES.map((role) =>
        serviceRoleView(role, state.builtins[role.id as ServiceRoleId]),
      ),
      ...state.roles.map(chatRoleView),
    ],
    file: rolesFile(),
  };
}

/** One role by id, for opening a chat or capturing its snapshot. */
export async function readAgentRole(
  id: string,
  projectId?: string,
): Promise<AgentRoleView | undefined> {
  if (projectId) {
    const project = await projectRoleState(projectId);
    const projectRole = project.roles.find((role) => role.id === id);
    // A project role with this id shadows the global one even when the file is not trusted.
    if (projectRole) return project.trusted ? projectRole : undefined;
  }
  const state = await readState();
  if (isServiceRoleId(id)) {
    const role = BUILTIN_SERVICE_ROLES.find((item) => item.id === id);
    return role ? serviceRoleView(role, state.builtins[id]) : undefined;
  }
  const role = state.roles.find((item) => item.id === id);
  return role ? chatRoleView(role) : undefined;
}

/**
 * Stores one service role's model; an empty selection returns it to the chat's model, and for a
 * media role — to the first available model of its capability. The context text is kept only for
 * media roles: chat-model service roles run with their own fixed prompts.
 */
export async function saveServiceRole(
  id: string,
  value: unknown,
  prompt?: unknown,
): Promise<AgentRoleSettings> {
  if (!isServiceRoleId(id)) throw new Error(`Неизвестная служебная роль: ${id}`);
  const selection = normalizeRoleSelection(value);
  const context = serviceRoleMedia(id) ? serviceRolePromptOf(prompt) : undefined;
  return withFileLock(rolesFile(), async () => {
    const state = await readState();
    if (Object.keys(selection).length || context)
      state.builtins[id] = { selection, ...(context ? { prompt: context } : {}) };
    else delete state.builtins[id];
    await writeState(state);
    return roleSettings();
  });
}

/** Removes the service role's own model: it follows the chat again. */
export async function resetServiceRole(id: string): Promise<AgentRoleSettings> {
  if (!isServiceRoleId(id)) throw new Error(`Неизвестная служебная роль: ${id}`);
  return withFileLock(rolesFile(), async () => {
    const state = await readState();
    delete state.builtins[id];
    await writeState(state);
    return roleSettings();
  });
}

/** Generates a stable id for a role created in the settings. */
function newRoleId(existing: readonly AgentRole[]): string {
  for (;;) {
    const id = `role-${randomBytes(4).toString("hex")}`;
    if (!isServiceRoleId(id) && !existing.some((role) => role.id === id)) return id;
  }
}

/** Creates a chat role; service roles are never user-created. */
export async function createChatRole(value: unknown): Promise<AgentRoleSettings> {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return withFileLock(rolesFile(), async () => {
    const state = await readState();
    const id = newRoleId(state.roles);
    const role = normalizeAgentRole({ ...(input as object), id, kind: "chat" });
    if (!role || role.kind !== "chat" || isServiceRoleId(role.id))
      throw new Error("Некорректная роль: укажите название и агента");
    state.roles = [...state.roles, role];
    await writeState(state);
    const settings = await roleSettings();
    return { ...settings, created: chatRoleView(role) };
  });
}

/** Replaces an existing chat role; the id is part of the address and cannot be changed here. */
export async function saveChatRole(id: string, value: unknown): Promise<AgentRoleSettings> {
  if (isServiceRoleId(id)) throw new Error("Служебная роль настраивается отдельно");
  return withFileLock(rolesFile(), async () => {
    const state = await readState();
    const index = state.roles.findIndex((role) => role.id === id);
    if (index < 0) throw new Error(`Неизвестная роль: ${id}`);
    const role = normalizeAgentRole({ ...(value as object), id, kind: "chat" });
    if (!role || role.kind !== "chat")
      throw new Error("Некорректная роль: укажите название и агента");
    state.roles = state.roles.map((item) => (item.id === id ? role : item));
    await writeState(state);
    return roleSettings();
  });
}

/** Deletes a chat role; chats that already started keep their saved snapshot. */
export async function deleteChatRole(id: string): Promise<AgentRoleSettings> {
  if (isServiceRoleId(id)) throw new Error("Служебную роль нельзя удалить");
  return withFileLock(rolesFile(), async () => {
    const state = await readState();
    if (!state.roles.some((role) => role.id === id)) throw new Error(`Неизвестная роль: ${id}`);
    state.roles = state.roles.filter((role) => role.id !== id);
    await writeState(state);
    return roleSettings();
  });
}

/** The model the service call should use: the role's own provider over the chat's fallback. */
export async function serviceRoleSelection(
  id: ServiceRoleId,
  fallback?: AgentRoleSelection,
): Promise<AgentRoleSelection> {
  const state = await readState();
  return { ...fallback, ...state.builtins[id]?.selection };
}

/** The context a media role sends with its call; undefined for roles without one. */
export async function serviceRolePrompt(id: ServiceRoleId): Promise<string | undefined> {
  const state = await readState();
  return state.builtins[id]?.prompt;
}
