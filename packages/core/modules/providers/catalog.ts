/**
 * What Projector knows about a chat model beyond its id: the window, the tariff, what it accepts
 * and one line for people. The catalog lives on the server and travels with the model list; the
 * settings show it and prefill the editable fields, the chat keeps using those fields for cost.
 */

export type ProviderModelModality = "text" | "image" | "audio" | "video" | "vector";

/** What the model is for, read from its modalities and id; a chat model is the default. */
export type ProviderModelKind =
  | "chat"
  | "image"
  | "speech"
  | "transcription"
  | "video"
  | "embedding"
  | "rerank"
  | "other";

/** Negotiated abilities, not modalities: a model can see images and still not call tools. */
export type ProviderModelCapability =
  | "tools"
  | "reasoning"
  | "vision"
  | "audio-input"
  | "video-input"
  | "json";

/** The price of a million tokens in the provider's tariff currency. */
export interface ProviderModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ProviderModelInfo {
  id: string;
  /** The provider's own name for people, when it differs from the id. */
  name?: string;
  /** One or two sentences: what the model is good at and where it fits. */
  description?: string;
  /** What the model is for: chat, image generation, speech, transcription, video, embeddings. */
  kind?: ProviderModelKind;
  contextTokens?: number;
  maxOutputTokens?: number;
  input?: ProviderModelModality[];
  output?: ProviderModelModality[];
  capabilities?: ProviderModelCapability[];
  price?: ProviderModelPrice;
  /** How the tariff works when it is not a single figure, e.g. tiers by context length. */
  priceNote?: string;
  /** Currency of `price`, `USD` when the provider does not say otherwise. */
  currency?: string;
  /** Official page the facts and rates were taken from. */
  source?: string;
  /** ISO date the source was checked. */
  checkedAt?: string;
  deprecated?: boolean;
}

/** The details of one model out of a provider's catalog, keyed by the id the provider uses. */
export type ProviderModelCatalog = Record<string, ProviderModelInfo>;

/** A capability for people: «видит изображения», «вызывает инструменты». */
export function providerModelCapabilityTitle(capability: ProviderModelCapability): string {
  switch (capability) {
    case "tools":
      return "инструменты";
    case "reasoning":
      return "рассуждение";
    case "vision":
      return "изображения";
    case "audio-input":
      return "звук";
    case "video-input":
      return "видео";
    case "json":
      return "JSON";
  }
}

/** The kind of model for a badge: «чат», «изображения», «распознавание». */
export function providerModelKindTitle(kind: ProviderModelKind): string {
  switch (kind) {
    case "chat":
      return "чат";
    case "image":
      return "изображения";
    case "speech":
      return "синтез речи";
    case "transcription":
      return "распознавание";
    case "video":
      return "видео";
    case "embedding":
      return "эмбеддинги";
    case "rerank":
      return "ранжирование";
    case "other":
      return "другое";
  }
}

/**
 * What goes in and what comes out, as one line: `текст → изображение`, `звук → текст`.
 * Empty when the catalog does not know the modalities.
 */
export function providerModelShape(
  input: readonly ProviderModelModality[] | undefined,
  output: readonly ProviderModelModality[] | undefined,
): string {
  if (!input?.length && !output?.length) return "";
  const list = (values: readonly ProviderModelModality[] | undefined) =>
    values?.length ? values.map(providerModelModalityTitle).join(" + ") : "?";
  return `${list(input)} → ${list(output)}`;
}

/** The kind derived from modalities, for entries that did not bring one explicitly. */
export function providerModelKindOf(
  info: Pick<ProviderModelInfo, "id" | "kind" | "input" | "output">,
): ProviderModelKind {
  if (info.kind) return info.kind;
  const input = info.input ?? [];
  const output = info.output ?? [];
  if (output.includes("video")) return "video";
  if (output.includes("image")) return "image";
  if (output.includes("audio")) return "speech";
  if (
    input.includes("audio") &&
    !input.some((item) => item === "text" || item === "image" || item === "video") &&
    output.includes("text")
  )
    return "transcription";
  return "chat";
}

/** A modality for people. */
export function providerModelModalityTitle(modality: ProviderModelModality): string {
  switch (modality) {
    case "text":
      return "текст";
    case "image":
      return "изображение";
    case "audio":
      return "звук";
    case "video":
      return "видео";
    case "vector":
      return "вектор";
  }
}

/**
 * A price as one compact line: `$1,4 / $4,4 за 1 млн`. Both figures are per million tokens:
 * the input first, the output second, the way the provider card reads.
 */
export function formatProviderModelPrice(
  price: ProviderModelPrice,
  currency = "USD",
  locale = "ru-RU",
): string {
  const signs: Record<string, string> = { USD: "$", EUR: "€", CNY: "¥", RUB: "₽" };
  const money = (value: number) => {
    const amount = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    }).format(value);
    return signs[currency] ? `${signs[currency]}${amount}` : `${amount} ${currency}`;
  };
  return `${money(price.input)} / ${money(price.output)} за 1 млн`;
}

/** A context window in short form: `128K`, `1M`, `200K`. */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}
