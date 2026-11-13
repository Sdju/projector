import { HttpError } from "../http/index.ts";
import { resolveOpenAIProvider } from "./provider-store.ts";
import { providerUsageResolver } from "./usage-registry.ts";
import type { ProviderUsage } from "./usage-registry.ts";

const READ_TIMEOUT_MS = 30000;

/** Расход выбранного (по умолчанию активного) провайдера через зарегистрированный читатель. */
export async function providerUsage(providerId?: string): Promise<ProviderUsage> {
  const provider = await resolveOpenAIProvider({ providerId });
  const resolver = providerUsageResolver(provider.kind);
  if (!resolver) throw new HttpError(400, `Вид провайдера «${provider.kind}» не отдаёт расход`);
  return resolver.read({
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    url: provider.url,
    apiKey: provider.apiKey,
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
}
