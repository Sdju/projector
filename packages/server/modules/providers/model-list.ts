import {
  loadStoredProviders,
  resolveOpenAIProvider,
  envFallbackFromProcess,
} from "./provider-store.ts";
import type { ProviderKind } from "./types.ts";
import { preloadProviderModelCatalog, providerModelCatalog } from "./model-catalog.ts";
import { fetchRemoteModels } from "./models.ts";
import type { ProviderModelCatalog } from "@ai-projector/core/modules/providers/index.ts";

export interface ProviderModelList {
  models: string[];
  /** What Projector knows about the listed models: window, tariff, abilities and description. */
  details: ProviderModelCatalog;
}

/**
 * Models a provider offers upstream. A draft may bring its own address and key; the stored key is
 * used only for a provider that is already saved, never for an unknown id.
 */
export async function listProviderModels(input: {
  id?: string;
  url?: string;
  kind?: string;
  apiKey?: string;
}): Promise<ProviderModelList> {
  const fallback = envFallbackFromProcess();
  const stored = await loadStoredProviders(fallback);
  const known = stored.providers.find((item) => item.id === input.id);
  const url = input.url?.trim() || known?.url || "";
  const kind: ProviderKind | undefined = input.kind?.trim() || known?.kind;
  const typed = input.apiKey?.trim() ?? "";
  const apiKey =
    typed ||
    (known ? (await resolveOpenAIProvider({ providerId: known.id, fallback })).apiKey : "");
  const shared = preloadProviderModelCatalog();
  const models = await fetchRemoteModels(url, apiKey, kind);
  const details = await providerModelCatalog({ ids: models, kind, shared });
  return { models, details };
}
