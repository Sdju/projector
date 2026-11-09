export interface AgentMcpServer {
  name: string;
  source: "user" | "project";
  kind: "stdio" | "http" | "sse";
}

export interface AgentMcp {
  /** The user's list as written in the file. */
  text: string;
  servers: AgentMcpServer[];
}

async function call<T>(init?: RequestInit, projectId = ""): Promise<T> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const response = await fetch(`/api/agent/mcp${query}`, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Не удалось получить MCP-серверы агента");
  return data as T;
}

export const readAgentMcp = (projectId = "") => call<AgentMcp>(undefined, projectId);

/** Saves the user's server list (`{ "mcpServers": { … } }`); empty text removes it. */
export const writeAgentMcp = (text: string) =>
  call<{ ok: true }>({ method: "PUT", body: JSON.stringify({ text }) });
