import { firstProjectId } from "./controls.ts";

/** A skill or prompt command a role may select from the Projector folders. */
export interface RoleSkill {
  name: string;
  description: string;
  kind: "skill" | "command";
  source: "user" | "project";
}

/** An MCP server a role may connect to: the user's list plus the project's `.mcp.json`. */
export interface RoleMcpServer {
  name: string;
  source: "user" | "project";
  kind: "stdio" | "http" | "sse";
}

export interface RoleResources {
  skills: RoleSkill[];
  mcp: RoleMcpServer[];
}

const cache = new Map<string, Promise<RoleResources>>();

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error((data as { error?: string }).error || "Не удалось получить ресурсы роли");
  return data as T;
}

/**
 * Skills and MCP servers a role can pick from. The project gives the project role its own folder,
 * while a global role uses the first registered project, like the controls of external agents.
 */
export async function roleResources(projectId = "", force = false): Promise<RoleResources> {
  const id = projectId || (await firstProjectId());
  const key = id || "-";
  if (!force) {
    const known = cache.get(key);
    if (known) return known;
  }
  const loading = Promise.all([
    readJson<{ skills: RoleSkill[] }>(`/api/agent/skills?projectId=${encodeURIComponent(id)}`),
    readJson<{ servers: RoleMcpServer[] }>(
      `/api/agent/mcp${id ? `?projectId=${encodeURIComponent(id)}` : ""}`,
    ),
  ]).then(([skills, mcp]) => ({
    skills: Array.isArray(skills.skills) ? skills.skills : [],
    mcp: Array.isArray(mcp.servers) ? mcp.servers : [],
  }));
  cache.set(key, loading);
  loading.catch(() => cache.delete(key));
  return loading;
}
