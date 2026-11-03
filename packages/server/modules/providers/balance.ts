import { createHash } from "node:crypto";
import { HttpError } from "../http/index.ts";
import { normalizeOpenAiBaseUrl } from "./openai-client.ts";
import { resolveOpenAIProvider } from "./provider-store.ts";
import type { ProviderBalance, ProviderBalanceEntry, ResolvedOpenAIProvider } from "./types.ts";

const READY_TTL_MS = 60000;
const FAILED_TTL_MS = 15000;

interface CacheEntry {
  value?: ProviderBalance;
  pending?: Promise<ProviderBalance>;
}
const globalState = globalThis as typeof globalThis & {
  projectorProviderBalance?: Map<string, CacheEntry>;
};
const cache = (globalState.projectorProviderBalance ??= new Map());

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const amount = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))
    ? value.trim()
    : null;

/** DeepSeek `GET /user/balance`: amounts are decimal strings, one entry per currency. */
export function deepseekEntries(payload: unknown): ProviderBalanceEntry[] | null {
  const infos = record(payload)?.balance_infos;
  if (!Array.isArray(infos)) return null;
  const entries: ProviderBalanceEntry[] = [];
  for (const item of infos) {
    const info = record(item);
    const total = amount(info?.total_balance);
    const granted = amount(info?.granted_balance);
    const toppedUp = amount(info?.topped_up_balance);
    if (typeof info?.currency !== "string" || !info.currency || !total || !granted || !toppedUp)
      return null;
    entries.push({ currency: info.currency, total, granted, toppedUp });
  }
  return entries;
}

function unavailable(message: string): ProviderBalance {
  return { status: "unavailable", entries: [], available: null, checkedAt: Date.now(), message };
}

async function readDeepseek(provider: ResolvedOpenAIProvider): Promise<ProviderBalance> {
  if (!provider.apiKey) return unavailable("Нет ключа API");
  // The balance lives next to the chat API, so the key only goes where it already goes.
  const endpoint = `${new URL(normalizeOpenAiBaseUrl(provider.url)).origin}/user/balance`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${provider.apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
  } catch {
    return unavailable("Не удалось получить баланс DeepSeek");
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401) return unavailable("DeepSeek отклонил ключ API");
    return unavailable(`DeepSeek: ошибка HTTP ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return unavailable("Некорректный ответ DeepSeek");
  }
  const entries = deepseekEntries(payload);
  if (!entries) return unavailable("Некорректный ответ DeepSeek");
  const flag = record(payload)?.is_available;
  return {
    status: "ready",
    entries,
    available: typeof flag === "boolean" ? flag : null,
    checkedAt: Date.now(),
    message: null,
  };
}

function load(provider: ResolvedOpenAIProvider): Promise<ProviderBalance> {
  if (provider.kind === "deepseek") return readDeepseek(provider);
  const message =
    provider.kind === "qwencloud"
      ? "Qwen Cloud не отдаёт баланс по ключу API"
      : provider.kind === "local"
        ? "Локальному провайдеру баланс не нужен"
        : "Для этого провайдера баланс недоступен";
  return Promise.resolve({
    status: "unsupported",
    entries: [],
    available: null,
    checkedAt: Date.now(),
    message,
  });
}

/** Balance of the given (default: active) provider; one upstream call per minute and key. */
export async function providerBalance(providerId?: string): Promise<ProviderBalance> {
  const provider = await resolveOpenAIProvider({ providerId }).catch((error) => {
    if (error instanceof HttpError) return null;
    throw error;
  });
  if (!provider) return unavailable("Провайдер не настроен");
  const key = createHash("sha256")
    .update(`${provider.id}\n${provider.kind}\n${provider.url}\n${provider.apiKey}`)
    .digest("hex");
  const entry = cache.get(key) ?? {};
  if (!cache.has(key) && cache.size >= 32) cache.delete(cache.keys().next().value as string);
  cache.set(key, entry);
  if (entry.pending) return entry.pending;
  const ttl = entry.value?.status === "ready" ? READY_TTL_MS : FAILED_TTL_MS;
  if (entry.value && Date.now() < entry.value.checkedAt + ttl) return entry.value;
  entry.pending = load(provider)
    .then((value) => (entry.value = value))
    .finally(() => {
      entry.pending = undefined;
    });
  return entry.pending;
}
