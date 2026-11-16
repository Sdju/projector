import { createHash } from "node:crypto";
import { HttpError } from "../http/index.ts";
import { normalizeOpenAiBaseUrl } from "./openai-client.ts";
import {
  envFallbackFromProcess,
  loadStoredProviders,
  resolveOpenAIProvider,
} from "./provider-store.ts";
import {
  balanceResolver,
  registerBalanceResolver,
  type ProviderBalanceContext,
  type ProviderBalanceReading,
  type ProviderBalanceResolver,
} from "./balance-registry.ts";
import type { ProviderBalance, ProviderBalanceEntry, ResolvedOpenAIProvider } from "./types.ts";

const READY_TTL_MS = 60000;
const FAILED_TTL_MS = 15000;
const READ_TIMEOUT_MS = 10000;

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

const amount = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  return /^\d+(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text)) ? text : null;
};

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

function unavailable(message: string): ProviderBalanceReading {
  return { status: "unavailable", entries: [], available: null, message };
}

function unsupported(message: string): ProviderBalanceReading {
  return { status: "unsupported", entries: [], available: null, message };
}

function providerUnavailable(message: string): ProviderBalance {
  return { ...unavailable(message), checkedAt: Date.now() };
}

async function readDeepseek(context: ProviderBalanceContext): Promise<ProviderBalanceReading> {
  if (!context.apiKey) return unavailable("Нет ключа API");
  // The balance lives next to the chat API, so the key only goes where it already goes.
  const endpoint = `${new URL(normalizeOpenAiBaseUrl(context.url)).origin}/user/balance`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${context.apiKey}`, Accept: "application/json" },
      signal: context.signal,
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
    message: null,
  };
}

const deepseekResolver: ProviderBalanceResolver = {
  kind: "deepseek",
  title: "DeepSeek",
  url: "https://api.deepseek.com",
  model: "deepseek-chat",
  read: readDeepseek,
};
registerBalanceResolver(deepseekResolver);

function openrouterAmount(value: unknown): string | null {
  const text =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  return /^\d+(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text)) ? text : null;
}

function subtractDecimal(left: string, right: string): string | null {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftWhole = BigInt(`${leftInteger}${leftFraction.padEnd(scale, "0")}`);
  const rightWhole = BigInt(`${rightInteger}${rightFraction.padEnd(scale, "0")}`);
  const difference = leftWhole - rightWhole;
  if (difference < 0) return null;
  const text = difference.toString().padStart(scale + 1, "0");
  return scale ? `${text.slice(0, -scale)}.${text.slice(-scale)}` : text;
}

/** OpenRouter `GET /api/v1/credits`: the wallet is purchased credits minus usage. */
export function openrouterEntries(payload: unknown): ProviderBalanceEntry[] | null {
  const data = record(record(payload)?.data);
  const credits = openrouterAmount(data?.total_credits);
  const usage = openrouterAmount(data?.total_usage);
  if (!credits || !usage) return null;
  const total = subtractDecimal(credits, usage);
  if (total === null) return null;
  return [{ currency: "USD", total, granted: "0", toppedUp: credits }];
}

async function readOpenRouter(context: ProviderBalanceContext): Promise<ProviderBalanceReading> {
  if (!context.apiKey) return unavailable("Нет ключа API");
  const endpoint = `${new URL(normalizeOpenAiBaseUrl(context.url)).origin}/api/v1/credits`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${context.apiKey}`, Accept: "application/json" },
      signal: context.signal,
      redirect: "error",
    });
  } catch {
    return unavailable("Не удалось получить баланс OpenRouter");
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403)
      return unavailable("OpenRouter отклонил ключ: для баланса нужен management key");
    return unavailable(`OpenRouter: ошибка HTTP ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return unavailable("Некорректный ответ OpenRouter");
  }
  const entries = openrouterEntries(payload);
  if (!entries) return unavailable("Некорректный ответ OpenRouter");
  return { status: "ready", entries, available: null, message: null };
}

const openrouterResolver: ProviderBalanceResolver = {
  kind: "openrouter",
  title: "OpenRouter",
  url: "https://openrouter.ai/api/v1",
  model: "openrouter/auto",
  read: readOpenRouter,
};
registerBalanceResolver(openrouterResolver);

/** A plugin reader may return only part of the shape; everything unsafe is dropped here. */
function normalizeReading(value: unknown): ProviderBalanceReading {
  const payload = record(value);
  if (!payload) return unavailable("Некорректный ответ баланса");
  const status =
    payload.status === "ready"
      ? "ready"
      : payload.status === "unavailable"
        ? "unavailable"
        : "unsupported";
  const available = typeof payload.available === "boolean" ? payload.available : null;
  const message =
    typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim().slice(0, 300)
      : null;
  if (status !== "ready") return { status, entries: [], available, message };
  if (!Array.isArray(payload.entries)) return unavailable("Провайдер не вернул баланс");
  const entries: ProviderBalanceEntry[] = [];
  for (const item of payload.entries) {
    const entry = record(item);
    const currency = typeof entry?.currency === "string" ? entry.currency.trim().slice(0, 16) : "";
    const total = amount(entry?.total);
    const granted = amount(entry?.granted ?? "0");
    const toppedUp = amount(entry?.toppedUp ?? "0");
    if (!currency || !total || !granted || !toppedUp) continue;
    entries.push({ currency, total, granted, toppedUp });
  }
  if (!entries.length) return unavailable("Провайдер не вернул баланс");
  return { status: "ready", entries, available, message };
}

async function load(provider: ResolvedOpenAIProvider): Promise<ProviderBalance> {
  const resolver = balanceResolver(provider.kind);
  if (!resolver) {
    const message =
      provider.kind === "local"
        ? "Локальному провайдеру баланс не нужен"
        : "Для этого провайдера баланс недоступен";
    return { ...unsupported(message), checkedAt: Date.now() };
  }
  const context: ProviderBalanceContext = {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    url: provider.url,
    apiKey: provider.balanceApiKey || provider.apiKey,
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  };
  let reading: ProviderBalanceReading;
  try {
    reading = normalizeReading(await resolver.read(context));
  } catch (error) {
    console.error(`Провайдер ${provider.id}: баланс недоступен: ${(error as Error).message}`);
    reading = unavailable("Не удалось получить баланс провайдера");
  }
  return { ...reading, checkedAt: Date.now() };
}

/** Balance of the given (default: active) provider; one upstream call per minute and key. */
export async function providerBalance(providerId?: string): Promise<ProviderBalance> {
  const provider = await resolveOpenAIProvider({ providerId }).catch((error) => {
    if (error instanceof HttpError) return null;
    throw error;
  });
  if (!provider) return providerUnavailable("Провайдер не настроен");
  /** The route and the analytics store need to know whose money this is. */
  const decorate = (value: ProviderBalance): ProviderBalance => ({
    ...value,
    providerId: provider.id,
    providerName: provider.name,
    providerKind: provider.kind,
  });
  const key = createHash("sha256")
    .update(
      `${provider.id}\n${provider.kind}\n${provider.url}\n${provider.balanceApiKey || provider.apiKey}`,
    )
    .digest("hex");
  const entry = cache.get(key) ?? {};
  if (!cache.has(key) && cache.size >= 32) cache.delete(cache.keys().next().value as string);
  cache.set(key, entry);
  if (entry.pending) return entry.pending;
  const ttl = entry.value?.status === "ready" ? READY_TTL_MS : FAILED_TTL_MS;
  if (entry.value && Date.now() < entry.value.checkedAt + ttl) return entry.value;
  entry.pending = load(provider)
    .then((value) => (entry.value = decorate(value)))
    .finally(() => {
      entry.pending = undefined;
    });
  return entry.pending;
}

/**
 * Money balances of every enabled provider whose kind has a reader. A failing provider does not
 * hide the others; the analytics route records every answer it gets.
 */
export async function providerBalances(): Promise<ProviderBalance[]> {
  const fallback = envFallbackFromProcess();
  const stored = await loadStoredProviders(fallback);
  const list = stored.providers.filter(
    (provider) => provider.enabled && provider.url.trim() && balanceResolver(provider.kind),
  );
  const settled = await Promise.allSettled(list.map((provider) => providerBalance(provider.id)));
  return settled.flatMap((result, index) => {
    if (result.status === "fulfilled") return [result.value];
    const provider = list[index]!;
    return [
      {
        status: "unavailable" as const,
        entries: [],
        available: null,
        checkedAt: Date.now(),
        message: "Не удалось получить баланс провайдера",
        providerId: provider.id,
        providerName: provider.name,
        providerKind: provider.kind,
      },
    ];
  });
}
