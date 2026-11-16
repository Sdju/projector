import { readFile } from "node:fs/promises";
import { providersPath } from "@ai-projector/core/modules/app-paths/index.ts";
import { setAsideBroken, writeFileAtomic, withFileLock } from "../atomic-files/index.ts";
import { HttpError } from "../http/index.ts";
import { vault as systemVault } from "../secrets/index.ts";
import { inferProviderKind, isProviderKind } from "./kinds.ts";
import { resolveModel, sanitizeModels } from "./models.ts";
import { defaultThinkingStyle, isThinkingStyle } from "./thinking.ts";
import { providerReaderKinds } from "./reader-kinds.ts";
import { DEFAULT_MODEL, ENV_PROVIDER_ID, envProvider, seededConfig } from "./provider-seeds.ts";
import { DEFAULT_PROVIDERS_SECRET, revealSecret } from "./secret-obfuscation.ts";
import {
  fallbackModelOf,
  fallbackOf,
  normalizeStoredProvider,
  sanitizeName,
  sanitizeProviderId,
  sanitizeUrl,
  toPublic,
} from "./provider-normalize.ts";
import type {
  EnvOpenAIFallback,
  OpenAIProviderWrite,
  OpenAIProvidersPublicState,
  OpenAIProvidersWriteState,
  ResolvedOpenAIProvider,
  StoredOpenAIProvider,
  StoredProvidersConfig,
} from "./types.ts";

let providerVault = systemVault;
/** Test hook: replaces the secret vault. */
export const useProviderVault = (next: typeof systemVault) => {
  providerVault = next;
};
const keyAccount = (id: string, balance = false) => `provider:${id}${balance ? ":balance" : ""}`;

/** Записи providers.json идут по очереди: два сохранения не должны потерять друг друга. */
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  return withFileLock(providersPath(), fn);
}

export async function loadStoredProviders(
  fallback: EnvOpenAIFallback = {},
): Promise<StoredProvidersConfig> {
  const file = providersPath();
  try {
    let parsed: { activeProviderId?: unknown; providers?: unknown };
    try {
      const value: unknown = JSON.parse(await readFile(file, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new SyntaxError("providers.json не объект");
      parsed = value;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      const backup = await setAsideBroken(file);
      console.error(
        backup
          ? `providers.json повреждён и сохранён как ${backup}:`
          : "providers.json повреждён и уже удалён, сохранять нечего:",
        error.message,
      );
      return seededConfig(fallback);
    }
    const providers = Array.isArray(parsed.providers)
      ? parsed.providers
          .map((item, index) => normalizeStoredProvider(item, index))
          .filter((item): item is StoredOpenAIProvider => item !== null)
      : [];
    if (providers.length === 0) return seededConfig(fallback);
    const activeProviderId =
      typeof parsed.activeProviderId === "string" &&
      providers.some((item) => item.id === parsed.activeProviderId)
        ? parsed.activeProviderId
        : (providers[0]?.id ?? null);
    return { activeProviderId, providers };
  } catch (error) {
    // A missing file is the first run; any other failure must not look like one.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return seededConfig(fallback);
    throw error;
  }
}

export async function loadPublicProviders(
  fallback: EnvOpenAIFallback = {},
): Promise<OpenAIProvidersPublicState> {
  // Keys left in the file by older versions move into the keyring on first view.
  await migrateProviderKeys(fallback).catch((error) =>
    console.error("Перенос ключей провайдеров в системное хранилище:", error.message),
  );
  const stored = await loadStoredProviders(fallback);
  return {
    activeProviderId: stored.activeProviderId,
    providers: stored.providers.map((item) => toPublic(item, fallback.apiKey)),
    ...providerReaderKinds(),
  };
}

async function writeProvidersFile(config: StoredProvidersConfig): Promise<void> {
  await writeFileAtomic(providersPath(), `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Keys live only in the OS keyring; the providers file holds settings and never a new key. Without
 * a reachable keyring a key cannot be saved, so the caller refuses before the user types one.
 */
export async function assertKeyStore(): Promise<void> {
  if ((await providerVault.storage()).backend !== "keyring")
    throw new HttpError(
      409,
      "Ключи провайдеров хранятся в системном хранилище секретов, оно недоступно",
    );
}

async function storeKey(id: string, plain: string, balance = false): Promise<void> {
  await assertKeyStore();
  await providerVault.set(keyAccount(id, balance), `Projector: провайдер ${id}`, plain);
}

async function mergeProviderWrite(
  item: OpenAIProviderWrite,
  index: number,
  existingById: Map<string, StoredOpenAIProvider>,
): Promise<StoredOpenAIProvider> {
  const id =
    typeof item.id === "string" && item.id.trim()
      ? sanitizeProviderId(item.id)
      : `provider-${index + 1}`;
  const previous = existingById.get(id);
  const url = sanitizeUrl(item.url);
  const kind = isProviderKind(item.kind) ? item.kind : (previous?.kind ?? inferProviderKind(url));
  const base = {
    id,
    name: sanitizeName(item.name, `Провайдер ${index + 1}`),
    kind,
    thinkingStyle: isThinkingStyle(item.thinkingStyle)
      ? item.thinkingStyle
      : (previous?.thinkingStyle ?? defaultThinkingStyle(kind)),
    ...fallbackOf(item.fallbackModel ?? previous?.fallbackModel),
    url,
    enabled: item.enabled === undefined ? (previous?.enabled ?? true) : item.enabled !== false,
    models:
      item.models === undefined && !item.model
        ? (previous?.models ?? [])
        : sanitizeModels(item.models, item.model),
  };
  const stored: StoredOpenAIProvider = {
    ...base,
    apiKey: previous?.apiKey ?? "",
    ...(previous?.vault ? { vault: previous.vault } : {}),
    ...(previous?.balanceApiKey ? { balanceApiKey: previous.balanceApiKey } : {}),
    ...(previous?.balanceVault ? { balanceVault: previous.balanceVault } : {}),
  };
  if (typeof item.apiKey === "string") {
    const plain = item.apiKey.trim();
    if (plain) {
      await storeKey(id, plain);
      stored.apiKey = "";
      stored.vault = "keyring";
    } else {
      stored.apiKey = "";
      delete stored.vault;
    }
  }
  if (typeof item.balanceApiKey === "string") {
    const plain = item.balanceApiKey.trim();
    if (plain) {
      await storeKey(id, plain, true);
      stored.balanceApiKey = "";
      stored.balanceVault = "keyring";
    } else {
      stored.balanceApiKey = "";
      delete stored.balanceVault;
    }
  }
  return stored;
}

/** Removes keyring entries of providers that were deleted or whose key was cleared. */
async function dropRetiredKeys(
  before: StoredOpenAIProvider[],
  after: StoredOpenAIProvider[],
): Promise<void> {
  for (const old of before) {
    if (
      old.vault === "keyring" &&
      !after.some((item) => item.id === old.id && item.vault === "keyring")
    )
      await providerVault.delete(keyAccount(old.id));
    if (
      old.balanceVault === "keyring" &&
      !after.some((item) => item.id === old.id && item.balanceVault === "keyring")
    )
      await providerVault.delete(keyAccount(old.id, true));
  }
}

export async function saveProviders(
  payload: OpenAIProvidersWriteState,
  fallback: EnvOpenAIFallback = {},
): Promise<OpenAIProvidersPublicState> {
  return withWriteLock(async () => {
    const existing = await loadStoredProviders(fallback);
    const existingById = new Map(existing.providers.map((item) => [item.id, item]));
    const providers = await Promise.all(
      payload.providers.map((item, index) => mergeProviderWrite(item, index, existingById)),
    );
    // Keyring entries go before the file, so a failed keyring write keeps the previous state.
    await dropRetiredKeys(existing.providers, providers);
    if (providers.length === 0) {
      const next = { activeProviderId: null, providers: [] };
      await writeProvidersFile(next);
      return {
        activeProviderId: null,
        providers: [],
        ...providerReaderKinds(),
      };
    }
    const requestedActive =
      typeof payload.activeProviderId === "string"
        ? payload.activeProviderId
        : existing.activeProviderId;
    const activeProviderId = providers.some((item) => item.id === requestedActive)
      ? requestedActive
      : providers[0].id;
    const next = { activeProviderId, providers };
    await writeProvidersFile(next);
    return {
      activeProviderId,
      providers: providers.map((item) => toPublic(item, fallback.apiKey)),
      ...providerReaderKinds(),
    };
  });
}

export async function setActiveProvider(
  providerId: string,
  fallback: EnvOpenAIFallback = {},
): Promise<OpenAIProvidersPublicState> {
  return withWriteLock(async () => {
    const stored = await loadStoredProviders(fallback);
    const id = sanitizeProviderId(providerId);
    if (!stored.providers.some((item) => item.id === id)) {
      throw new HttpError(404, "Провайдер не найден");
    }
    const next = { ...stored, activeProviderId: id };
    await writeProvidersFile(next);
    return {
      activeProviderId: id,
      providers: stored.providers.map((item) => toPublic(item, fallback.apiKey)),
      ...providerReaderKinds(),
    };
  });
}

function revealFileKey(storedKey: string, secret: string): string {
  if (!storedKey.trim()) return "";
  try {
    return revealSecret(storedKey, secret);
  } catch {
    return "";
  }
}

async function revealProviderKey(
  provider: StoredOpenAIProvider,
  secret: string,
  envKey: string,
  balance = false,
): Promise<string> {
  const storedKey = balance ? (provider.balanceApiKey ?? "") : provider.apiKey;
  const storedVault = balance ? provider.balanceVault : provider.vault;
  if (!balance && provider.id === ENV_PROVIDER_ID && !storedKey.trim()) return envKey.trim();
  if (storedVault !== "keyring") return revealFileKey(storedKey, secret);
  try {
    return (await providerVault.get(keyAccount(provider.id, balance))) ?? "";
  } catch (error) {
    console.error(`Провайдер ${provider.id}: ключ недоступен: ${(error as Error).message}`);
    return "";
  }
}

async function toResolved(
  provider: StoredOpenAIProvider,
  secret: string,
  envKey: string,
  modelName?: string,
): Promise<ResolvedOpenAIProvider> {
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    thinkingStyle: provider.thinkingStyle,
    url: provider.url.trim(),
    ...resolveModel(provider.models, modelName, DEFAULT_MODEL),
    fallback: fallbackModelOf(provider),
    apiKey: await revealProviderKey(provider, secret, envKey),
    balanceApiKey: await revealProviderKey(provider, secret, envKey, true),
  };
}

/**
 * Moves keys still kept in the providers file into the keyring once it is reachable. The file is
 * rewritten only after each keyring value reads back identically.
 */
export function migrateProviderKeys(fallback: EnvOpenAIFallback = {}): Promise<void> {
  return withWriteLock(async () => {
    if ((await providerVault.storage()).backend !== "keyring") return;
    const stored = await loadStoredProviders(fallback);
    const secret = fallback.secret || DEFAULT_PROVIDERS_SECRET;
    let moved = false;
    const providers: StoredOpenAIProvider[] = [];
    for (const item of stored.providers) {
      const next = { ...item };
      for (const balance of [false, true]) {
        const storedKey = balance ? (item.balanceApiKey ?? "") : item.apiKey;
        const storedVault = balance ? item.balanceVault : item.vault;
        const plain = storedVault || !storedKey.trim() ? "" : revealFileKey(storedKey, secret);
        if (!plain) continue;
        const account = keyAccount(item.id, balance);
        await providerVault.set(account, `Projector: провайдер ${item.id}`, plain);
        if ((await providerVault.get(account)) !== plain)
          throw new Error(`Не удалось проверить ключ провайдера ${item.id}`);
        if (balance) {
          next.balanceApiKey = "";
          next.balanceVault = "keyring";
        } else {
          next.apiKey = "";
          next.vault = "keyring";
        }
        moved = true;
      }
      providers.push(next);
    }
    if (moved) await writeProvidersFile({ activeProviderId: stored.activeProviderId, providers });
  });
}

export async function resolveOpenAIProvider(
  options: {
    providerId?: string;
    /** Registered name of the model; without a match the provider's first model. */
    model?: string;
    fallback?: EnvOpenAIFallback;
  } = {},
): Promise<ResolvedOpenAIProvider> {
  const fallback = options.fallback ?? envFallbackFromProcess();
  const secret = fallback.secret || DEFAULT_PROVIDERS_SECRET;
  const stored = await loadStoredProviders(fallback);
  const requested = options.providerId?.trim();
  const selected =
    stored.providers.find((item) => item.id === requested) ||
    stored.providers.find((item) => item.id === stored.activeProviderId) ||
    stored.providers[0];

  const envKey = fallback.apiKey ?? "";
  if (selected?.url.trim()) return toResolved(selected, secret, envKey, options.model);

  const fromEnv = envProvider(fallback);
  if (fromEnv?.url.trim()) return toResolved(fromEnv, secret, envKey, options.model);

  throw new HttpError(400, "Провайдер Qwen/OpenAI не настроен");
}

export function envFallbackFromProcess(): EnvOpenAIFallback {
  return {
    url: process.env.OPENAI_URL || process.env.QWEN_URL,
    apiKey:
      process.env.OPENAI_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.QWENCLOUD_API_KEY,
    model: process.env.OPENAI_MODEL || process.env.QWEN_MODEL,
    secret: process.env.PROVIDERS_SECRET,
  };
}
