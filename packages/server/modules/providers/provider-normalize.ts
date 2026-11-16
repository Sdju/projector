import { HttpError } from "../http/index.ts";
import { inferProviderKind, isProviderKind } from "./kinds.ts";
import { sanitizeModels } from "./models.ts";
import { defaultThinkingStyle, isThinkingStyle } from "./thinking.ts";
import { ENV_PROVIDER_ID } from "./provider-seeds.ts";
import type {
  OpenAIProviderPublic,
  ResolvedOpenAIProvider,
  StoredOpenAIProvider,
} from "./types.ts";

export function sanitizeProviderId(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  if (!cleaned) throw new HttpError(400, "Некорректный id провайдера");
  return cleaned;
}

export function sanitizeName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.replace(/\s+/g, " ").trim().slice(0, 80) || fallback;
}

export const sanitizeUrl = (value: unknown): string =>
  typeof value === "string" ? value.trim().slice(0, 500) : "";

export function toPublic(provider: StoredOpenAIProvider, envKey = ""): OpenAIProviderPublic {
  const fromEnv = provider.id === ENV_PROVIDER_ID && envKey.trim() !== "";
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    thinkingStyle: provider.thinkingStyle,
    ...(provider.fallbackModel ? { fallbackModel: provider.fallbackModel } : {}),
    url: provider.url,
    enabled: provider.enabled,
    models: provider.models,
    hasApiKey: provider.vault === "keyring" || Boolean(provider.apiKey.trim()) || fromEnv,
    ...(provider.balanceVault === "keyring" || provider.balanceApiKey?.trim()
      ? { hasBalanceApiKey: true }
      : {}),
  };
}

export const fallbackOf = (value: unknown) =>
  typeof value === "string" && value.trim() ? { fallbackModel: value.trim().slice(0, 200) } : {};

/** The fallback model of a provider, when it is still one of the registered models. */
export function fallbackModelOf(
  provider: StoredOpenAIProvider,
): ResolvedOpenAIProvider["fallback"] {
  const chosen = provider.models.find((item) => item.alias === provider.fallbackModel);
  return chosen
    ? { model: chosen.id, modelName: chosen.alias, thinking: chosen.thinking, price: chosen.price }
    : undefined;
}

export function normalizeStoredProvider(
  value: unknown,
  index: number,
): StoredOpenAIProvider | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  try {
    const id =
      typeof record.id === "string" && record.id.trim()
        ? sanitizeProviderId(record.id)
        : `provider-${index + 1}`;
    const url = sanitizeUrl(record.url);
    const kind = isProviderKind(record.kind) ? record.kind : inferProviderKind(url);
    return {
      id,
      name: sanitizeName(record.name, `Провайдер ${index + 1}`),
      kind,
      thinkingStyle: isThinkingStyle(record.thinkingStyle)
        ? record.thinkingStyle
        : defaultThinkingStyle(kind),
      ...fallbackOf(record.fallbackModel),
      url,
      enabled: record.enabled !== false,
      models: sanitizeModels(record.models, record.model),
      apiKey: typeof record.apiKey === "string" ? record.apiKey : "",
      ...(record.vault === "keyring" ? { vault: "keyring" as const } : {}),
      ...(typeof record.balanceApiKey === "string" ? { balanceApiKey: record.balanceApiKey } : {}),
      ...(record.balanceVault === "keyring" ? { balanceVault: "keyring" as const } : {}),
    };
  } catch {
    return null;
  }
}
