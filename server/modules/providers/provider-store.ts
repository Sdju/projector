import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { providersPath } from "../../../core/modules/app-paths/index.ts";
import { HttpError } from "../http/index.ts";
import { vault as systemVault } from "../secrets/index.ts";
import { DEFAULT_PROVIDERS_SECRET, revealSecret } from "./secret-obfuscation.ts";
import type {
  EnvOpenAIFallback,
  OpenAIProviderPublic,
  OpenAIProviderWrite,
  OpenAIProvidersPublicState,
  OpenAIProvidersWriteState,
  ResolvedOpenAIProvider,
  StoredOpenAIProvider,
  StoredProvidersConfig,
} from "./types.ts";

const ENV_PROVIDER_ID = "env-default";
const QWEN_PROVIDER_ID = "qwen-dashscope";
let writeChain: Promise<unknown> = Promise.resolve();
let providerVault = systemVault;
/** Test hook: replaces the secret vault. */
export const useProviderVault = (next: typeof systemVault) => {
  providerVault = next;
};
const keyAccount = (id: string) => `provider:${id}`;

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function sanitizeProviderId(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  if (!cleaned) throw new HttpError(400, "Некорректный id провайдера");
  return cleaned;
}

function sanitizeName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.replace(/\s+/g, " ").trim().slice(0, 80) || fallback;
}

function sanitizeUrl(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function sanitizeModel(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

function toPublic(provider: StoredOpenAIProvider, envKey = ""): OpenAIProviderPublic {
  const fromEnv = provider.id === ENV_PROVIDER_ID && envKey.trim() !== "";
  return {
    id: provider.id,
    name: provider.name,
    url: provider.url,
    model: provider.model,
    hasApiKey: provider.vault === "keyring" || Boolean(provider.apiKey.trim()) || fromEnv,
  };
}

/** The key of the environment provider is read from the process environment, never stored. */
function envProvider(fallback: EnvOpenAIFallback): StoredOpenAIProvider | null {
  const url = fallback.url?.trim();
  if (!url) return null;
  return {
    id: ENV_PROVIDER_ID,
    name: "Из .env",
    url,
    model: fallback.model?.trim() || "qwen3.8-flash",
    apiKey: "",
  };
}

function qwenSeed(): StoredOpenAIProvider {
  return {
    id: QWEN_PROVIDER_ID,
    name: "Qwen / DashScope",
    url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.8-flash",
    apiKey: "",
  };
}

function seededConfig(fallback: EnvOpenAIFallback): StoredProvidersConfig {
  const fromEnv = envProvider(fallback);
  const providers = fromEnv ? [fromEnv, qwenSeed()] : [qwenSeed()];
  return { activeProviderId: providers[0].id, providers };
}

function normalizeStoredProvider(value: unknown, index: number): StoredOpenAIProvider | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  try {
    const id =
      typeof record.id === "string" && record.id.trim()
        ? sanitizeProviderId(record.id)
        : `provider-${index + 1}`;
    return {
      id,
      name: sanitizeName(record.name, `Провайдер ${index + 1}`),
      url: sanitizeUrl(record.url),
      model: sanitizeModel(record.model),
      apiKey: typeof record.apiKey === "string" ? record.apiKey : "",
      ...(record.vault === "keyring" ? { vault: "keyring" as const } : {}),
    };
  } catch {
    return null;
  }
}

export async function loadStoredProviders(
  fallback: EnvOpenAIFallback = {},
): Promise<StoredProvidersConfig> {
  try {
    const raw = await readFile(providersPath(), "utf8");
    const parsed = JSON.parse(raw) as { activeProviderId?: unknown; providers?: unknown };
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
  } catch {
    return seededConfig(fallback);
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
  };
}

async function writeProvidersFile(config: StoredProvidersConfig): Promise<void> {
  const file = providersPath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
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

async function storeKey(
  id: string,
  plain: string,
): Promise<Pick<StoredOpenAIProvider, "apiKey" | "vault">> {
  await assertKeyStore();
  await providerVault.set(keyAccount(id), `Projector: провайдер ${id}`, plain);
  return { apiKey: "", vault: "keyring" };
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
  const base = {
    id,
    name: sanitizeName(item.name, `Провайдер ${index + 1}`),
    url: sanitizeUrl(item.url),
    model: sanitizeModel(item.model),
  };
  if (typeof item.apiKey === "string") {
    const plain = item.apiKey.trim();
    return { ...base, ...(plain ? await storeKey(id, plain) : { apiKey: "" }) };
  }
  // No key in the payload: keep the one already stored, wherever it lives.
  return {
    ...base,
    apiKey: previous?.apiKey ?? "",
    ...(previous?.vault ? { vault: previous.vault } : {}),
  };
}

/** Removes keyring entries of providers that were deleted or whose key was cleared. */
async function dropRetiredKeys(
  before: StoredOpenAIProvider[],
  after: StoredOpenAIProvider[],
): Promise<void> {
  for (const old of before) {
    if (old.vault !== "keyring") continue;
    if (after.some((item) => item.id === old.id && item.vault === "keyring")) continue;
    await providerVault.delete(keyAccount(old.id));
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
      return { activeProviderId: null, providers: [] };
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
): Promise<string> {
  if (provider.id === ENV_PROVIDER_ID && !provider.apiKey.trim()) return envKey.trim();
  if (provider.vault !== "keyring") return revealFileKey(provider.apiKey, secret);
  try {
    return (await providerVault.get(keyAccount(provider.id))) ?? "";
  } catch (error) {
    console.error(`Провайдер ${provider.id}: ключ недоступен: ${(error as Error).message}`);
    return "";
  }
}

async function toResolved(
  provider: StoredOpenAIProvider,
  secret: string,
  envKey: string,
): Promise<ResolvedOpenAIProvider> {
  return {
    id: provider.id,
    name: provider.name,
    url: provider.url.trim(),
    model: provider.model.trim() || "qwen3.8-flash",
    apiKey: await revealProviderKey(provider, secret, envKey),
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
      const plain = item.vault || !item.apiKey.trim() ? "" : revealFileKey(item.apiKey, secret);
      if (!plain) {
        providers.push(item);
        continue;
      }
      await providerVault.set(keyAccount(item.id), `Projector: провайдер ${item.id}`, plain);
      if ((await providerVault.get(keyAccount(item.id))) !== plain)
        throw new Error(`Не удалось проверить ключ провайдера ${item.id}`);
      providers.push({ ...item, apiKey: "", vault: "keyring" });
      moved = true;
    }
    if (moved) await writeProvidersFile({ activeProviderId: stored.activeProviderId, providers });
  });
}

export async function resolveOpenAIProvider(
  options: {
    providerId?: string;
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
  if (selected?.url.trim()) return toResolved(selected, secret, envKey);

  const fromEnv = envProvider(fallback);
  if (fromEnv?.url.trim()) return toResolved(fromEnv, secret, envKey);

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

export function isDashScopeProviderUrl(url: string): boolean {
  const value = url.trim().toLowerCase();
  return (
    value.includes("dashscope") || value.includes("aliyuncs.com") || value.includes("qwencloud")
  );
}
