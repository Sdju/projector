import type {
  AgentRole,
  AgentRoleSelection,
  AgentRoleView,
} from "@projector-ai/core/modules/agent-role/index.ts";

export interface AgentRoleSettings {
  roles: AgentRoleView[];
  file: string;
  created?: AgentRoleView;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Роли агентов недоступны");
  return data as T;
}

export function readAgentRoles(): Promise<AgentRoleSettings> {
  return call<AgentRoleSettings>("/api/agent/roles");
}

export function writeServiceRole(
  role: string,
  selection: AgentRoleSelection,
): Promise<AgentRoleSettings> {
  return call<AgentRoleSettings>(`/api/agent/roles/${encodeURIComponent(role)}`, {
    method: "PUT",
    body: JSON.stringify({ selection }),
  });
}

export function resetServiceRole(role: string): Promise<AgentRoleSettings> {
  return call<AgentRoleSettings>(`/api/agent/roles/${encodeURIComponent(role)}/reset`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** A new chat role; the server gives it an id and returns it in `created`. */
export function createChatRole(role: Partial<AgentRole>): Promise<AgentRoleSettings> {
  return call<AgentRoleSettings>("/api/agent/roles", {
    method: "POST",
    body: JSON.stringify({ role: { ...role, kind: "chat" } }),
  });
}

export function writeChatRole(id: string, role: Partial<AgentRole>): Promise<AgentRoleSettings> {
  return call<AgentRoleSettings>(`/api/agent/roles/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ role: { ...role, kind: "chat" } }),
  });
}

export function removeChatRole(id: string): Promise<AgentRoleSettings> {
  return call<AgentRoleSettings>(`/api/agent/roles/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
