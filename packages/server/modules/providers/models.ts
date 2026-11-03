import { HttpError } from "../http/index.ts";
import { normalizeOpenAiBaseUrl } from "./openai-client.ts";
import type { ModelPrice, ProviderModel, ResolvedOpenAIProvider } from "./types.ts";

const MAX_MODELS = 500;
const LIST_TIMEOUT_MS = 10_000;
const MIN_CONTEXT = 1_000;
const MAX_CONTEXT = 100_000_000;

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 200) : "";
}

/** A context window in tokens; anything that is not a sane whole number counts as unknown. */
function contextTokens(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number)) return undefined;
  return number >= MIN_CONTEXT && number <= MAX_CONTEXT ? number : undefined;
}

/** The price of a million tokens; input and output are needed, a wrong figure drops the whole price. */
export function sanitizePrice(value: unknown): ModelPrice | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const figure = (item: unknown) => {
    const number = typeof item === "string" && item.trim() ? Number(item) : item;
    return typeof number === "number" && Number.isFinite(number) && number >= 0 && number < 1e6
      ? number
      : undefined;
  };
  const input = figure(record.input);
  const output = figure(record.output);
  if (input === undefined || output === undefined) return undefined;
  const cacheRead = figure(record.cacheRead);
  const cacheWrite = figure(record.cacheWrite);
  return {
    input,
    output,
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
  };
}

/** Registered models of one provider; the alias defaults to the id and stays unique. */
export function sanitizeModels(value: unknown, legacyModel?: unknown): ProviderModel[] {
  const source: unknown[] = Array.isArray(value) ? value : legacyModel ? [{ id: legacyModel }] : [];
  const seen = new Set<string>();
  const models: ProviderModel[] = [];
  for (const item of source) {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const id = clean(typeof item === "string" ? item : record.id);
    if (!id) continue;
    const alias = clean(record.alias) || id;
    if (seen.has(alias)) continue;
    seen.add(alias);
    const context = contextTokens(record.contextTokens);
    const price = sanitizePrice(record.price);
    models.push({
      id,
      alias,
      ...(context ? { contextTokens: context } : {}),
      ...(price ? { price } : {}),
      ...(record.thinking === false ? { thinking: false } : {}),
    });
    if (models.length >= MAX_MODELS) break;
  }
  return models;
}

/** The model a request names by its registered name; without a match the provider's first one. */
export function pickModel(models: readonly ProviderModel[], name?: string): ProviderModel | null {
  const wanted = name?.trim();
  return models.find((item) => item.alias === wanted) ?? models[0] ?? null;
}

/** What a request needs of the model it names: the upstream id, the registered name and the window. */
export function resolveModel(
  models: readonly ProviderModel[],
  name: string | undefined,
  fallback: string,
): Pick<ResolvedOpenAIProvider, "model" | "modelName" | "contextTokens" | "thinking" | "price"> {
  const chosen = pickModel(models, name);
  return {
    model: chosen?.id ?? fallback,
    modelName: chosen?.alias ?? fallback,
    contextTokens: chosen?.contextTokens,
    thinking: chosen?.thinking,
    price: chosen?.price,
  };
}

/** Model ids from `GET <base>/models` of an OpenAI-compatible server (also Ollama's `models`). */
export async function fetchRemoteModels(url: string, apiKey: string): Promise<string[]> {
  if (!url.trim()) throw new HttpError(400, "Укажите адрес провайдера");
  let response: Response;
  try {
    response = await fetch(`${normalizeOpenAiBaseUrl(url)}/models`, {
      headers: {
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new HttpError(502, `Провайдер не отвечает: ${(error as Error).message}`);
  }
  if (!response.ok)
    throw new HttpError(502, `Провайдер не отдал список моделей (HTTP ${response.status})`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new HttpError(502, "Провайдер вернул не JSON: список моделей не поддерживается");
  }
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const rows = Array.isArray(body)
    ? body
    : Array.isArray(record.data)
      ? record.data
      : record.models;
  if (!Array.isArray(rows)) throw new HttpError(502, "Провайдер не отдаёт список моделей");
  const ids = rows.map((row) => {
    const item = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    return clean(typeof row === "string" ? row : (item.id ?? item.name));
  });
  return [...new Set(ids.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
