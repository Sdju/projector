import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { providersPath } from "../paths.ts";
import { HttpError } from "./http.ts";
import { DEFAULT_PROVIDERS_SECRET, obfuscateSecret, revealSecret } from "./secret-obfuscation.ts";
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

function toPublic(provider: StoredOpenAIProvider): OpenAIProviderPublic {
  return {
    id: provider.id,
    name: provider.name,
    url: provider.url,
    model: provider.model,
    hasApiKey: Boolean(provider.apiKey.trim()),
  };
}

function envProvider(fallback: EnvOpenAIFallback): StoredOpenAIProvider | null {
  const url = fallback.url?.trim();
  if (!url) return null;
  return {
    id: ENV_PROVIDER_ID,
    name: "Из .env",
    url,
    model: fallback.model?.trim() || "qwen3.8-flash",
    apiKey: fallback.apiKey?.trim()
      ? obfuscateSecret(fallback.apiKey.trim(), fallback.secret || DEFAULT_PROVIDERS_SECRET)
      : "",
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
  const stored = await loadStoredProviders(fallback);
  return {
    activeProviderId: stored.activeProviderId,
    providers: stored.providers.map(toPublic),
  };
}

async function writeProvidersFile(config: StoredProvidersConfig): Promise<void> {
  const file = providersPath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function mergeProviderWrite(
  item: OpenAIProviderWrite,
  index: number,
  existingById: Map<string, StoredOpenAIProvider>,
  secret: string,
): StoredOpenAIProvider {
  const id =
    typeof item.id === "string" && item.id.trim()
      ? sanitizeProviderId(item.id)
      : `provider-${index + 1}`;
  const previous = existingById.get(id);
  let apiKey = previous?.apiKey ?? "";
  if (typeof item.apiKey === "string") {
    apiKey = item.apiKey.trim() ? obfuscateSecret(item.apiKey.trim(), secret) : "";
  }
  return {
    id,
    name: sanitizeName(item.name, `Провайдер ${index + 1}`),
    url: sanitizeUrl(item.url),
    model: sanitizeModel(item.model),
    apiKey,
  };
}

export async function saveProviders(
  payload: OpenAIProvidersWriteState,
  fallback: EnvOpenAIFallback = {},
): Promise<OpenAIProvidersPublicState> {
  return withWriteLock(async () => {
    const existing = await loadStoredProviders(fallback);
    const secret = fallback.secret || DEFAULT_PROVIDERS_SECRET;
    const existingById = new Map(existing.providers.map((item) => [item.id, item]));
    const providers = payload.providers.map((item, index) =>
      mergeProviderWrite(item, index, existingById, secret),
    );
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
    return { activeProviderId, providers: providers.map(toPublic) };
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
    return { activeProviderId: id, providers: stored.providers.map(toPublic) };
  });
}

function revealProviderKey(storedKey: string, secret: string): string {
  if (!storedKey.trim()) return "";
  try {
    return revealSecret(storedKey, secret);
  } catch {
    return "";
  }
}

function toResolved(provider: StoredOpenAIProvider, secret: string): ResolvedOpenAIProvider {
  return {
    id: provider.id,
    name: provider.name,
    url: provider.url.trim(),
    model: provider.model.trim() || "qwen3.8-flash",
    apiKey: revealProviderKey(provider.apiKey, secret),
  };
}

export async function resolveOpenAIProvider(options: {
  providerId?: string;
  fallback?: EnvOpenAIFallback;
} = {}): Promise<ResolvedOpenAIProvider> {
  const fallback = options.fallback ?? envFallbackFromProcess();
  const secret = fallback.secret || DEFAULT_PROVIDERS_SECRET;
  const stored = await loadStoredProviders(fallback);
  const requested = options.providerId?.trim();
  const selected =
    stored.providers.find((item) => item.id === requested) ||
    stored.providers.find((item) => item.id === stored.activeProviderId) ||
    stored.providers[0];

  if (selected?.url.trim()) return toResolved(selected, secret);

  const fromEnv = envProvider(fallback);
  if (fromEnv?.url.trim()) return toResolved(fromEnv, secret);

  throw new HttpError(400, "Провайдер Qwen/OpenAI не настроен");
}

export function envFallbackFromProcess(): EnvOpenAIFallback {
  return {
    url: process.env.OPENAI_URL || process.env.QWEN_URL,
    apiKey:
      process.env.OPENAI_API_KEY ||
      process.env.DASHSCOPE_API_KEY ||
      process.env.QWENCLOUD_API_KEY,
    model: process.env.OPENAI_MODEL || process.env.QWEN_MODEL,
    secret: process.env.PROVIDERS_SECRET,
  };
}

export function isDashScopeProviderUrl(url: string): boolean {
  const value = url.trim().toLowerCase();
  return (
    value.includes("dashscope") ||
    value.includes("aliyuncs.com") ||
    value.includes("qwencloud")
  );
}
