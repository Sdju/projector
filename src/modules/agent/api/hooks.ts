export interface AgentHook {
  event: "PreToolUse" | "PostToolUse" | "Stop";
  source: "user" | "project";
  command: string;
  matcher?: string;
}

export interface AgentHooks {
  /** The user's file as written. */
  text: string;
  hooks: AgentHook[];
}

async function call<T>(init?: RequestInit): Promise<T> {
  const response = await fetch("/api/agent/hooks", {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Не удалось получить хуки агента");
  return data as T;
}

export const readAgentHooks = () => call<AgentHooks>();

/** Saves the user's hooks (`{ "hooks": { … } }`); empty text removes the file. */
export const writeAgentHooks = (text: string) =>
  call<{ ok: true }>({ method: "PUT", body: JSON.stringify({ text }) });
