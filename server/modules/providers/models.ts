import { HttpError } from "../http/index.ts";
import { normalizeOpenAiBaseUrl } from "./openai-client.ts";
import type { ProviderModel } from "./types.ts";

const MAX_MODELS = 500;
const LIST_TIMEOUT_MS = 10_000;

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 200) : "";
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
    models.push({ id, alias });
    if (models.length >= MAX_MODELS) break;
  }
  return models;
}

/** The model a request names by its registered name; without a match the provider's first one. */
export function pickModel(models: readonly ProviderModel[], name?: string): ProviderModel | null {
  const wanted = name?.trim();
  return models.find((item) => item.alias === wanted) ?? models[0] ?? null;
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
