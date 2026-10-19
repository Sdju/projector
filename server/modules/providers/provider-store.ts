import { readFile } from "node:fs/promises";
import { providersPath } from "../../../core/modules/app-paths/index.ts";
import { setAsideBroken, writeFileAtomic } from "./atomic-file.ts";
import { HttpError } from "../http/index.ts";
import { vault as systemVault } from "../secrets/index.ts";
import { inferProviderKind, isProviderKind } from "./kinds.ts";
import { pickModel, sanitizeModels } from "./models.ts";
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
const DEFAULT_MODEL = "qwen3.8-flash";
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

const sanitizeUrl = (value: unknown): string =>
  typeof value === "string" ? value.trim().slice(0, 500) : "";

function toPublic(provider: StoredOpenAIProvider, envKey = ""): OpenAIProviderPublic {
  const fromEnv = provider.id === ENV_PROVIDER_ID && envKey.trim() !== "";
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    url: provider.url,
    enabled: provider.enabled,
    models: provider.models,
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
    kind: inferProviderKind(url),
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
    url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    enabled: true,
    models: sanitizeModels(null, DEFAULT_MODEL),
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
    const url = sanitizeUrl(record.url);
    return {
      id,
      name: sanitizeName(record.name, `Провайдер ${index + 1}`),
      kind: isProviderKind(record.kind) ? record.kind : inferProviderKind(url),
      url,
      enabled: record.enabled !== false,
      models: sanitizeModels(record.models, record.model),
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
      console.error(`providers.json повреждён и сохранён как ${backup}:`, error.message);
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
  const url = sanitizeUrl(item.url);
  const base = {
    id,
    name: sanitizeName(item.name, `Провайдер ${index + 1}`),
    kind: isProviderKind(item.kind) ? item.kind : (previous?.kind ?? inferProviderKind(url)),
    url,
    enabled: item.enabled === undefined ? (previous?.enabled ?? true) : item.enabled !== false,
    models:
      item.models === undefined && !item.model
        ? (previous?.models ?? [])
        : sanitizeModels(item.models, item.model),
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
  modelName?: string,
): Promise<ResolvedOpenAIProvider> {
  const chosen = pickModel(provider.models, modelName);
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    url: provider.url.trim(),
    model: chosen?.id ?? DEFAULT_MODEL,
    modelName: chosen?.alias ?? DEFAULT_MODEL,
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
