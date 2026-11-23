import { HttpError } from "../http/index.ts";
import {
  envFallbackFromProcess,
  loadStoredProviders,
  resolveOpenAIProvider,
} from "../providers/index.ts";
import { mediaAdapter } from "./registry.ts";
import type { MediaAdapter, MediaProviderContext } from "./types.ts";

export const SUBMIT_TIMEOUT_MS = 10 * 60 * 1000;
export const POLL_TIMEOUT_MS = 2 * 60 * 1000;

/** The adapter context of one provider; the key is already decrypted by the store. */
export function providerContext(
  id: string,
  name: string,
  kind: string,
  url: string,
  apiKey: string,
  signal?: AbortSignal,
): MediaProviderContext {
  return { id, name, kind, url, apiKey, signal: signal ?? AbortSignal.timeout(SUBMIT_TIMEOUT_MS) };
}

/** The media adapter and the enabled provider behind a request, with its key and address. */
export async function resolveMediaProvider(providerId?: string): Promise<{
  adapter: MediaAdapter;
  provider: Awaited<ReturnType<typeof resolveOpenAIProvider>>;
}> {
  const stored = await loadStoredProviders(envFallbackFromProcess());
  const requested = providerId?.trim();
  const found = requested
    ? stored.providers.find((provider) => provider.id === requested)
    : undefined;
  if (requested && !found) throw new HttpError(404, "Провайдер не найден");
  const selected =
    found ??
    stored.providers.find((provider) => provider.id === stored.activeProviderId) ??
    stored.providers[0];
  if (!selected) throw new HttpError(400, "Провайдер не настроен");
  if (!selected.enabled) throw new HttpError(400, "Провайдер выключен");
  const adapter = mediaAdapter(selected.kind);
  if (!adapter) throw new HttpError(400, `Вид провайдера «${selected.kind}» не поддерживает медиа`);
  const provider = await resolveOpenAIProvider({ providerId: selected.id });
  if (!provider.url.trim()) throw new HttpError(400, "У провайдера не задан адрес");
  if (adapter.requiresKey && !provider.apiKey)
    throw new HttpError(400, `У провайдера «${provider.name}» нет ключа API`);
  return { adapter, provider };
}
