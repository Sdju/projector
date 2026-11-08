/**
 * A named preset of an agent's model and settings. Service roles sit beside a chat and make one
 * small call with a fixed prompt; chat roles will describe a whole conversation. The contract is
 * shared by the settings, the API and the server-side resolver, so the page and the server agree
 * on what a role means before anything is sent to an agent.
 */
export type AgentRoleKind = "chat" | "service";

/** The values chosen for an agent's controls, by control id (`provider`, `model`, `thinking`, …). */
export type AgentRoleSelection = Record<string, string>;

export type AgentRolePermissionMode = "default" | "auto" | "bypassPermissions";

export interface AgentRole {
  /** Stable id; the built-in service ids are reserved. */
  id: string;
  name: string;
  description?: string;
  kind: AgentRoleKind;
  /** Backend id; every service role runs on the built-in Projector backend. */
  agent: string;
  selection: AgentRoleSelection;
  permissionMode?: AgentRolePermissionMode;
  /** The default for background jobs: work in an isolated copy of the project. */
  isolate?: boolean;
  /** Defined by the code, not by the user: it can be configured but not deleted. */
  builtin?: boolean;
}

/** A role captured when a chat starts: later edits of the role do not change that chat. */
export interface AgentRoleSnapshot {
  roleId: string;
  name: string;
  selection: AgentRoleSelection;
  permissionMode?: AgentRolePermissionMode;
}

/** A role as the settings show it: whether its model comes from the chat. */
export interface AgentRoleView extends AgentRole {
  /** No model of its own: the role follows the chat or the active provider. */
  inherited: boolean;
}

/** Project roles read from `.projector/roles.json`; they are inert until the file is trusted. */
export interface AgentProjectRoleState {
  projectId: string;
  /** Real folder of the project, the key of the trust decision. */
  path: string;
  file: string;
  exists: boolean;
  trusted: boolean;
  hash?: string;
  roles: AgentRoleView[];
  /** Why the file could not be read or is unsafe; roles stay empty. */
  problem?: string;
}

export const SERVICE_AGENT = "projector";

export const SERVICE_ROLE_IDS = ["doctor", "lens", "judge"] as const;

export type ServiceRoleId = (typeof SERVICE_ROLE_IDS)[number];

/** The roles Projector runs without a chat: a fixed prompt, no tools and one model call. */
export const BUILTIN_SERVICE_ROLES: readonly AgentRole[] = [
  {
    id: "doctor",
    name: "Доктор",
    description: "Чинит сломанную Vue-разметку форм и готовых ответов.",
    kind: "service",
    agent: SERVICE_AGENT,
    selection: {},
    builtin: true,
  },
  {
    id: "lens",
    name: "Lens",
    description: "Пишет короткую подпись о том, чем занят агент сейчас.",
    kind: "service",
    agent: SERVICE_AGENT,
    selection: {},
    builtin: true,
  },
  {
    id: "judge",
    name: "Судья",
    description: "Оценивает риск действия перед подтверждением.",
    kind: "service",
    agent: SERVICE_AGENT,
    selection: {},
    builtin: true,
  },
];

export function isServiceRoleId(value: unknown): value is ServiceRoleId {
  return typeof value === "string" && SERVICE_ROLE_IDS.includes(value as ServiceRoleId);
}

export function isBuiltinServiceRole(value: string): boolean {
  return isServiceRoleId(value);
}

export const ROLE_ID = /^[a-z][a-z0-9-]{1,39}$/;
export const ROLE_LIMITS = {
  name: 80,
  description: 400,
  agent: 40,
  selection: 24,
  key: 100,
  value: 300,
} as const;

/**
 * Keeps only the entries a control can use. A damaged settings file must not make the whole role
 * unreadable: an unknown value is dropped and the control keeps its default.
 */
export function normalizeRoleSelection(value: unknown): AgentRoleSelection {
  const selection: AgentRoleSelection = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return selection;
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(
    0,
    ROLE_LIMITS.selection,
  )) {
    if (typeof item !== "string") continue;
    const cleanKey = key.trim();
    const clean = item.trim();
    if (!cleanKey || cleanKey.length > ROLE_LIMITS.key || !clean) continue;
    if (clean.length > ROLE_LIMITS.value) continue;
    selection[cleanKey] = clean;
  }
  return selection;
}

/** Validates a role from a file or an API request; anything ambiguous is rejected, not guessed. */
export function normalizeAgentRole(value: unknown): AgentRole | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!ROLE_ID.test(id)) return undefined;
  const name = typeof row.name === "string" ? row.name.trim().slice(0, ROLE_LIMITS.name) : "";
  if (!name) return undefined;
  const kind = row.kind === "chat" || row.kind === "service" ? row.kind : undefined;
  if (!kind) return undefined;
  const agent = typeof row.agent === "string" ? row.agent.trim().slice(0, ROLE_LIMITS.agent) : "";
  if (!agent) return undefined;
  if (kind === "service" && agent !== SERVICE_AGENT) return undefined;
  const permissionMode =
    kind === "chat" &&
    (row.permissionMode === "default" ||
      row.permissionMode === "auto" ||
      row.permissionMode === "bypassPermissions")
      ? row.permissionMode
      : undefined;
  const description =
    typeof row.description === "string"
      ? row.description.trim().slice(0, ROLE_LIMITS.description)
      : "";
  return {
    id,
    name,
    kind,
    agent,
    selection: normalizeRoleSelection(row.selection),
    ...(description ? { description } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    ...(row.isolate === true ? { isolate: true } : {}),
  };
}

/** The settings a call should use: the role's own values over the chat's fallback. */
export function resolveRoleSelection(
  role: Pick<AgentRole, "selection"> | undefined,
  fallback?: AgentRoleSelection,
): AgentRoleSelection {
  return { ...fallback, ...role?.selection };
}

/** A service role follows the chat when it names no Projector provider of its own. */
export function serviceRoleInheritsModel(role: Pick<AgentRole, "selection">): boolean {
  return !role.selection.provider;
}

/** The values a chat keeps from its role; the role id and name stay readable after deletion. */
export function snapshotOfRole(role: AgentRole): AgentRoleSnapshot {
  return {
    roleId: role.id,
    name: role.name,
    selection: { ...role.selection },
    ...(role.permissionMode ? { permissionMode: role.permissionMode } : {}),
  };
}

/** Validates a snapshot from history or a tab; a damaged one is ignored instead of guessed. */
export function normalizeRoleSnapshot(value: unknown): AgentRoleSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const roleId = typeof row.roleId === "string" ? row.roleId.trim() : "";
  if (!ROLE_ID.test(roleId)) return undefined;
  const name = typeof row.name === "string" ? row.name.trim().slice(0, ROLE_LIMITS.name) : "";
  if (!name) return undefined;
  const permissionMode =
    row.permissionMode === "default" ||
    row.permissionMode === "auto" ||
    row.permissionMode === "bypassPermissions"
      ? row.permissionMode
      : undefined;
  return {
    roleId,
    name,
    selection: normalizeRoleSelection(row.selection),
    ...(permissionMode ? { permissionMode } : {}),
  };
}
