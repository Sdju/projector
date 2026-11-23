import type {
  ProviderModelCapability,
  ProviderModelCatalog,
  ProviderModelInfo,
  ProviderModelKind,
  ProviderModelModality,
} from "@ai-projector/core/modules/providers/index.ts";
import { CHECKED_AT, baseId, localEntry, localSource, mediaEntry } from "./model-catalog-data.ts";
import type { ProviderKind } from "./types.ts";

const OPENROUTER_MODELS = "https://openrouter.ai/api/v1/models";
const OPENROUTER_SOURCE = "https://openrouter.ai/models";
const CATALOG_TTL_MS = 60 * 60 * 1000;

const MODALITIES = new Set<ProviderModelModality>(["text", "image", "audio", "video", "vector"]);
const CAPABILITIES = new Set<ProviderModelCapability>([
  "tools",
  "reasoning",
  "vision",
  "audio-input",
  "video-input",
  "json",
]);

function number(value: unknown): number | undefined {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}

/** A per-token OpenRouter price as per-million-tokens money, the way the settings count. */
function perMillion(value: unknown): number | undefined {
  const parsed = number(value);
  return parsed === undefined ? undefined : Math.round(parsed * 1_000_000 * 1_000_000) / 1_000_000;
}

function modalities(value: unknown): ProviderModelModality[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is ProviderModelModality => MODALITIES.has(item));
  return list.length ? list : undefined;
}

function capabilitiesOf(
  input: ProviderModelModality[] | undefined,
  parameters: unknown,
): ProviderModelCapability[] | undefined {
  const list: ProviderModelCapability[] = [];
  const supported = Array.isArray(parameters) ? parameters : [];
  if (supported.includes("tools") || supported.includes("tool_choice")) list.push("tools");
  if (supported.includes("reasoning") || supported.includes("include_reasoning"))
    list.push("reasoning");
  if (supported.includes("response_format") || supported.includes("structured_outputs"))
    list.push("json");
  if (input?.includes("image")) list.push("vision");
  if (input?.includes("audio")) list.push("audio-input");
  if (input?.includes("video")) list.push("video-input");
  return list.length ? list.filter((item) => CAPABILITIES.has(item)) : undefined;
}

interface OpenRouterModel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  architecture?: { input_modalities?: unknown; output_modalities?: unknown };
  pricing?: Record<string, unknown>;
  supported_parameters?: unknown;
  top_provider?: { max_completion_tokens?: unknown };
}

/** What an OpenRouter entry is for, from its id and modalities. */
function openRouterKind(
  id: string,
  input: ProviderModelModality[] | undefined,
  output: ProviderModelModality[] | undefined,
): ProviderModelKind {
  if (/embedding/i.test(id)) return "embedding";
  if (/rerank/i.test(id)) return "rerank";
  if (output?.includes("video")) return "video";
  if (output?.includes("image")) return "image";
  if (output?.includes("audio")) return "speech";
  if (
    input?.includes("audio") &&
    !input.some((item) => item === "text" || item === "image" || item === "video") &&
    output?.includes("text") &&
    !output?.includes("audio")
  )
    return "transcription";
  return "chat";
}

function openRouterInfo(raw: OpenRouterModel, checkedAt: string): ProviderModelInfo | undefined {
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return undefined;
  const input = modalities(raw.architecture?.input_modalities);
  const output = modalities(raw.architecture?.output_modalities);
  const prompt = perMillion(raw.pricing?.prompt);
  const completion = perMillion(raw.pricing?.completion);
  const cacheRead = perMillion(raw.pricing?.input_cache_read);
  const cacheWrite = perMillion(raw.pricing?.input_cache_write);
  const description =
    typeof raw.description === "string" ? raw.description.replace(/\s+/g, " ").trim() : "";
  return {
    id,
    kind: openRouterKind(id, input, output),
    ...(typeof raw.name === "string" && raw.name.trim() ? { name: raw.name.trim() } : {}),
    ...(description ? { description: description.slice(0, 1_000) } : {}),
    ...(number(raw.context_length) ? { contextTokens: number(raw.context_length) } : {}),
    ...(number(raw.top_provider?.max_completion_tokens)
      ? { maxOutputTokens: number(raw.top_provider?.max_completion_tokens) }
      : {}),
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(capabilitiesOf(input, raw.supported_parameters)
      ? { capabilities: capabilitiesOf(input, raw.supported_parameters) }
      : {}),
    ...(prompt !== undefined && completion !== undefined
      ? {
          price: {
            input: prompt,
            output: completion,
            ...(cacheRead !== undefined ? { cacheRead } : {}),
            ...(cacheWrite !== undefined ? { cacheWrite } : {}),
          },
        }
      : {}),
    source: OPENROUTER_SOURCE,
    checkedAt,
  };
}

const cache = globalThis as typeof globalThis & {
  projectorOpenRouterCatalog?: { at: number; models: ProviderModelCatalog };
};

/** OpenRouter's public catalog, cached for an hour; a failure never breaks the model list. */
async function openRouterCatalog(): Promise<ProviderModelCatalog> {
  const now = Date.now();
  const known = cache.projectorOpenRouterCatalog;
  if (known && now - known.at < CATALOG_TTL_MS) return known.models;
  try {
    const response = await fetch(OPENROUTER_MODELS, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return known?.models ?? {};
    const body = (await response.json()) as { data?: unknown };
    const rows = Array.isArray(body.data) ? body.data : [];
    const models: ProviderModelCatalog = {};
    const checkedAt = new Date(now).toISOString().slice(0, 10);
    for (const row of rows) {
      const info = openRouterInfo((row ?? {}) as OpenRouterModel, checkedAt);
      if (info) models[info.id] = info;
    }
    cache.projectorOpenRouterCatalog = { at: now, models };
    return models;
  } catch {
    return known?.models ?? {};
  }
}

/** The OpenRouter entry for the same model id, matched by the part after the vendor prefix. */
function openRouterMatch(catalog: ProviderModelCatalog, id: string): ProviderModelInfo | undefined {
  const direct = catalog[id];
  if (direct) return direct;
  const wanted = baseId(id).toLowerCase();
  return Object.values(catalog).find(
    (item) => baseId(item.id.split("/").pop() ?? "").toLowerCase() === wanted,
  );
}

/** Starts the shared catalog request so it can overlap the provider's own model-list request. */
export function preloadProviderModelCatalog(): Promise<ProviderModelCatalog> {
  return openRouterCatalog();
}

/**
 * The catalog for the models a provider just listed. Prices and context come from the provider's
 * own rate card when Projector knows it; OpenRouter fills descriptions, modalities and abilities
 * for the same model id, and its prices are used only for an OpenRouter provider.
 */
export async function providerModelCatalog(input: {
  ids: readonly string[];
  kind?: ProviderKind | undefined;
  shared?: Promise<ProviderModelCatalog> | undefined;
}): Promise<ProviderModelCatalog> {
  const openrouter = await (input.shared ?? openRouterCatalog());
  const catalog: ProviderModelCatalog = {};
  for (const id of input.ids) {
    const local = mediaEntry(id) ?? localEntry(input.kind, id);
    const shared = input.kind === "openrouter" ? openrouter[id] : openRouterMatch(openrouter, id);
    const source = local?.source ?? localSource(input.kind) ?? shared?.source;
    const known = Boolean(local || shared);
    const kind = known
      ? (local?.kind ??
        shared?.kind ??
        openRouterKind(id, local?.input ?? shared?.input, local?.output ?? shared?.output))
      : undefined;
    // A known chat entry without modalities is still text in and text out; unknown ids say nothing.
    const modalities =
      local?.input ?? shared?.input ?? (known && kind === "chat" ? (["text"] as const) : undefined);
    const outputModalities =
      local?.output ??
      shared?.output ??
      (known && kind === "chat" ? (["text"] as const) : undefined) ??
      (kind === "embedding" || kind === "rerank" ? (["vector"] as const) : undefined);
    const info: ProviderModelInfo = {
      id,
      ...(kind ? { kind } : {}),
      ...(shared?.name ? { name: shared.name } : {}),
      ...(shared?.description ? { description: shared.description } : {}),
      ...((local?.contextTokens ?? shared?.contextTokens)
        ? { contextTokens: local?.contextTokens ?? shared?.contextTokens }
        : {}),
      ...((local?.maxOutputTokens ?? shared?.maxOutputTokens)
        ? { maxOutputTokens: local?.maxOutputTokens ?? shared?.maxOutputTokens }
        : {}),
      ...(modalities ? { input: modalities } : {}),
      ...(outputModalities ? { output: outputModalities } : {}),
      ...(() => {
        const capabilities = [
          ...new Set([...(local?.capabilities ?? []), ...(shared?.capabilities ?? [])]),
        ];
        return capabilities.length ? { capabilities } : {};
      })(),
      ...(input.kind === "openrouter" && shared?.price
        ? { price: shared.price }
        : local?.price
          ? { price: local.price }
          : {}),
      ...(local?.priceNote ? { priceNote: local.priceNote } : {}),
      ...(local?.currency ? { currency: local.currency } : {}),
      ...(source ? { source } : {}),
      ...(local || (input.kind === "openrouter" && shared)
        ? { checkedAt: local ? CHECKED_AT : (shared?.checkedAt ?? CHECKED_AT) }
        : {}),
      ...(local?.deprecated ? { deprecated: true } : {}),
    };
    // Details without any substance would only clutter the response.
    if (info.description || info.price || info.contextTokens || info.capabilities || info.input)
      catalog[id] = info;
  }
  return catalog;
}
