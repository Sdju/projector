export interface AgentMemory {
  user: string;
  projects: Array<{ path: string; text: string }>;
}

async function call<T>(init?: RequestInit): Promise<T> {
  const response = await fetch("/api/agent/memory", {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Не удалось получить заметки агента");
  return data as T;
}

export const readAgentMemory = () => call<AgentMemory>();

/** Replaces the notes of the user (no `path`) or of the project at `path`; empty text deletes them. */
export const writeAgentMemory = (text: string, path?: string) =>
  call<{ text: string }>({
    method: "PUT",
    body: JSON.stringify({ scope: path ? "project" : "user", path, text }),
  });
