import type {
  OpenAIProviderPublic,
  OpenAIProvidersPublicState,
  ProviderBalance,
  ProviderUsage,
} from "../model/types.ts";

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
  providers: Array<OpenAIProviderPublic & { apiKey?: string; balanceApiKey?: string }>;
}): Promise<OpenAIProvidersPublicState> {
  return request("/api/providers", { method: "PUT", body: JSON.stringify(payload) });
}

export function setActiveProvider(id: string): Promise<OpenAIProvidersPublicState> {
  return request("/api/providers/active", { method: "PATCH", body: JSON.stringify({ id }) });
}

export function fetchProviderBalance(id?: string): Promise<ProviderBalance> {
  return request(`/api/providers/balance${id ? `?id=${encodeURIComponent(id)}` : ""}`);
}

/** Расход и квоты провайдера; не путать с денежным балансом. */
export function fetchProviderUsage(id?: string): Promise<ProviderUsage> {
  return request(`/api/providers/usage${id ? `?id=${encodeURIComponent(id)}` : ""}`);
}

/** All enabled wallets in one answer; each entry still carries its provider id and name. */
export function fetchProviderBalances(): Promise<{
  wallets: ProviderBalance[];
  checkedAt: number;
}> {
  return request("/api/providers/balances");
}

/** Model ids the provider offers; a draft passes its own address and key. */
export async function fetchProviderModels(draft: {
  id: string;
  url: string;
  kind?: string;
  apiKey?: string;
}): Promise<string[]> {
  const { models } = await request<{ models: string[] }>("/api/providers/models", {
    method: "POST",
    body: JSON.stringify(draft),
  });
  return models;
}
