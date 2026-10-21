import { inferProviderKind } from "./kinds.ts";
import { sanitizeModels } from "./models.ts";
import { defaultThinkingStyle } from "./thinking.ts";
import type { EnvOpenAIFallback, StoredOpenAIProvider, StoredProvidersConfig } from "./types.ts";

export const ENV_PROVIDER_ID = "env-default";
const QWEN_PROVIDER_ID = "qwen-dashscope";
export const DEFAULT_MODEL = "qwen3.8-flash";

/** The key of the environment provider is read from the process environment, never stored. */
export function envProvider(fallback: EnvOpenAIFallback): StoredOpenAIProvider | null {
  const url = fallback.url?.trim();
  if (!url) return null;
  return {
    id: ENV_PROVIDER_ID,
    name: "Из .env",
    kind: inferProviderKind(url),
    thinkingStyle: defaultThinkingStyle(inferProviderKind(url)),
    url,
    enabled: true,
    models: sanitizeModels(null, fallback.model?.trim() || DEFAULT_MODEL),
    apiKey: "",
  };
}

function qwenSeed(): StoredOpenAIProvider {
  return {
    id: QWEN_PROVIDER_ID,
    name: "Qwen / DashScope",
    kind: "qwencloud",
    thinkingStyle: "qwen",
    url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    enabled: true,
    models: sanitizeModels(null, DEFAULT_MODEL),
    apiKey: "",
  };
}

export function seededConfig(fallback: EnvOpenAIFallback): StoredProvidersConfig {
  const fromEnv = envProvider(fallback);
  const providers = fromEnv ? [fromEnv, qwenSeed()] : [qwenSeed()];
  return { activeProviderId: providers[0].id, providers };
}
