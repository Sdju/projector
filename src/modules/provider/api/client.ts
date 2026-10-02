import type { OpenAIProviderPublic, OpenAIProvidersPublicState } from "../model/types.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

export function fetchProviders(): Promise<OpenAIProvidersPublicState> {
  return request("/api/providers");
}

export function saveProviders(payload: {
  activeProviderId: string | null;
  providers: Array<OpenAIProviderPublic & { apiKey?: string }>;
}): Promise<OpenAIProvidersPublicState> {
  return request("/api/providers", { method: "PUT", body: JSON.stringify(payload) });
}

export function setActiveProvider(id: string): Promise<OpenAIProvidersPublicState> {
  return request("/api/providers/active", { method: "PATCH", body: JSON.stringify({ id }) });
}
