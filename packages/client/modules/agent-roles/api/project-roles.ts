import type { AgentProjectRoleState, AgentRole } from "@projector/core/modules/agent-role/index.ts";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Роли проекта недоступны");
  return data as T;
}

export function readProjectRoles(projectId: string): Promise<AgentProjectRoleState> {
  return call<AgentProjectRoleState>(
    `/api/agent/project-roles?projectId=${encodeURIComponent(projectId)}`,
  );
}

export function createProjectRole(
  projectId: string,
  role: Partial<AgentRole>,
): Promise<AgentProjectRoleState> {
  return call<AgentProjectRoleState>("/api/agent/project-roles", {
    method: "POST",
    body: JSON.stringify({ projectId, role: { ...role, kind: "chat" } }),
  });
}

export function writeProjectRole(
  projectId: string,
  id: string,
  role: Partial<AgentRole>,
): Promise<AgentProjectRoleState> {
  return call<AgentProjectRoleState>(`/api/agent/project-roles/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ projectId, role: { ...role, kind: "chat" } }),
  });
}

export function removeProjectRole(projectId: string, id: string): Promise<AgentProjectRoleState> {
  return call<AgentProjectRoleState>(
    `/api/agent/project-roles/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
  );
}

export function setProjectRoleTrust(
  projectId: string,
  trusted: boolean,
): Promise<AgentProjectRoleState> {
  return call<AgentProjectRoleState>("/api/agent/project-roles/trust", {
    method: "PUT",
    body: JSON.stringify({ projectId, trusted }),
  });
}
