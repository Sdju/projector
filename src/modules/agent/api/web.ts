export type WebSearchProvider = "brave" | "searxng";

export interface AgentWeb {
  provider: WebSearchProvider;
  /** SearXNG instance address. */
  url: string;
  /** A key is stored; its value never reaches the browser. */
  hasKey: boolean;
}

async function call<T>(init?: RequestInit): Promise<T> {
  const response = await fetch("/api/agent/web", {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Не удалось получить настройки веб-поиска");
  return data as T;
}

export const readAgentWeb = () => call<AgentWeb>();

/** Chooses the service; an empty `apiKey` keeps the stored key, `null` removes it. */
export const writeAgentWeb = (input: {
  provider: WebSearchProvider;
  url: string;
  apiKey?: string | null;
}) => call<AgentWeb>({ method: "PUT", body: JSON.stringify(input) });
