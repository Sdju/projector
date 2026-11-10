import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  BUILTIN_SERVICE_ROLES,
  SERVICE_ROLE_IDS,
  isServiceRoleId,
  normalizeAgentRole,
  normalizeRoleSelection,
  serviceRoleInheritsModel,
  type AgentRole,
  type AgentRoleSelection,
  type AgentRoleView,
  type ServiceRoleId,
} from "@ai-projector/core/modules/agent-role/index.ts";
import { projectRoleState } from "./project.ts";

/** The user's choices for the built-in service roles: `$XDG_DATA_HOME/projector/agent/roles.json`. */
export const rolesFile = () => join(dataDir(), "agent", "roles.json");

interface StoredRoles {
  version: 1;
  /** User-created chat roles. Service roles are defined by the code and stored as overrides. */
  roles: AgentRole[];
  builtins: Partial<Record<ServiceRoleId, { selection: AgentRoleSelection }>>;
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
      if (Object.keys(selection).length) builtins[id] = { selection };
    }
  return { version: 1, roles, builtins };
}

async function readState(): Promise<StoredRoles> {
  try {
    return stateOf(await readFile(rolesFile(), "utf8"));
  } catch (error) {
    // A broken file is kept next to the settings instead of being silently overwritten.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      await rename(rolesFile(), `${rolesFile()}.broken-${Date.now()}`).catch(() => undefined);
    return empty();
  }
}

/** One write at a time: two settings requests must not lose each other's change. */
let queue: Promise<unknown> = Promise.resolve();

/** Writes through a temporary file, with the owner-only mode secrets-adjacent settings use. */
async function writeState(state: StoredRoles): Promise<void> {
  const path = rolesFile();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
}

function serviceRoleView(role: AgentRole, selection: AgentRoleSelection): AgentRoleView {
  return {
    ...role,
    selection,
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
        serviceRoleView(role, state.builtins[role.id as ServiceRoleId]?.selection ?? {}),
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
    return role ? serviceRoleView(role, state.builtins[id]?.selection ?? {}) : undefined;
  }
  const role = state.roles.find((item) => item.id === id);
  return role ? chatRoleView(role) : undefined;
}

/** Stores one service role's selection; an empty selection returns it to the chat's model. */
export async function saveServiceRole(id: string, value: unknown): Promise<AgentRoleSettings> {
  if (!isServiceRoleId(id)) throw new Error(`Неизвестная служебная роль: ${id}`);
  const selection = normalizeRoleSelection(value);
  const task = queue.then(async () => {
    const state = await readState();
    if (Object.keys(selection).length) state.builtins[id] = { selection };
    else delete state.builtins[id];
    await writeState(state);
    return roleSettings();
  });
  queue = task.catch(() => undefined);
  return task;
}

/** Removes the service role's own model: it follows the chat again. */
export async function resetServiceRole(id: string): Promise<AgentRoleSettings> {
  if (!isServiceRoleId(id)) throw new Error(`Неизвестная служебная роль: ${id}`);
  const task = queue.then(async () => {
    const state = await readState();
    delete state.builtins[id];
    await writeState(state);
    return roleSettings();
  });
  queue = task.catch(() => undefined);
  return task;
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
  const task = queue.then(async () => {
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
  queue = task.catch(() => undefined);
  return task;
}

/** Replaces an existing chat role; the id is part of the address and cannot be changed here. */
export async function saveChatRole(id: string, value: unknown): Promise<AgentRoleSettings> {
  if (isServiceRoleId(id)) throw new Error("Служебная роль настраивается отдельно");
  const task = queue.then(async () => {
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
  queue = task.catch(() => undefined);
  return task;
}

/** Deletes a chat role; chats that already started keep their saved snapshot. */
export async function deleteChatRole(id: string): Promise<AgentRoleSettings> {
  if (isServiceRoleId(id)) throw new Error("Служебную роль нельзя удалить");
  const task = queue.then(async () => {
    const state = await readState();
    if (!state.roles.some((role) => role.id === id)) throw new Error(`Неизвестная роль: ${id}`);
    state.roles = state.roles.filter((role) => role.id !== id);
    await writeState(state);
    return roleSettings();
  });
  queue = task.catch(() => undefined);
  return task;
}

/** The model the service call should use: the role's own provider over the chat's fallback. */
export async function serviceRoleSelection(
  id: ServiceRoleId,
  fallback?: AgentRoleSelection,
): Promise<AgentRoleSelection> {
  const state = await readState();
  return { ...fallback, ...state.builtins[id]?.selection };
}
