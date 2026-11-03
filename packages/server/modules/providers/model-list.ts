import {
  loadStoredProviders,
  resolveOpenAIProvider,
  envFallbackFromProcess,
} from "./provider-store.ts";
import { fetchRemoteModels } from "./models.ts";

/**
 * Models a provider offers upstream. A draft may bring its own address and key; the stored key is
 * used only for a provider that is already saved, never for an unknown id.
 */
export async function listProviderModels(input: {
  id?: string;
  url?: string;
  apiKey?: string;
}): Promise<string[]> {
  const fallback = envFallbackFromProcess();
  const stored = await loadStoredProviders(fallback);
  const known = stored.providers.find((item) => item.id === input.id);
  const url = input.url?.trim() || known?.url || "";
  const typed = input.apiKey?.trim() ?? "";
  const apiKey =
    typed ||
    (known ? (await resolveOpenAIProvider({ providerId: known.id, fallback })).apiKey : "");
  return fetchRemoteModels(url, apiKey);
}
