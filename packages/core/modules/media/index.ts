/**
 * Универсальные контракты медиа-моделей. Модуль browser-safe: его используют и клиент, и сервер,
 * а конкретные провайдеры подключаются адаптерами на сервере.
 */

/** Что умеет модель. Набор намеренно маленький: всё остальное — параметры конкретной модели. */
export type MediaCapability =
  | "image.generate"
  | "speech.synthesize"
  | "speech.transcribe"
  | "video.generate";

export const MEDIA_CAPABILITIES: readonly MediaCapability[] = [
  "image.generate",
  "speech.synthesize",
  "speech.transcribe",
  "video.generate",
];

export function isMediaCapability(value: unknown): value is MediaCapability {
  return typeof value === "string" && (MEDIA_CAPABILITIES as readonly string[]).includes(value);
}

/** What a media model accepts or returns, besides its primary capability. */
export type MediaModality = "text" | "image" | "audio" | "video";

/** What a provider bills for. */
export type MediaPriceUnit =
  | "image"
  | "second"
  | "minute"
  | "10k-characters"
  | "1m-characters"
  | "1m-tokens"
  | "request";

/** One published rate; the source and date live on the model, not on every line. */
export interface MediaModelPrice {
  amount: number;
  /** ISO code, usually `USD`. */
  currency: string;
  unit: MediaPriceUnit;
  /** Which part of the call this rate covers; absent means the whole call. */
  appliesTo?: "call" | "input" | "output" | "audio-output";
  /** Resolution or size tier, e.g. `720P`, `1K`. */
  variant?: string;
  /** The provider itself presents this figure as an estimate. */
  estimated?: boolean;
}

/** Everything known about a media model besides its provider and its capability. */
export interface MediaModelDetails {
  /** One or two sentences: what the model does and where it fits. */
  description?: string;
  input?: MediaModality[];
  output?: MediaModality[];
  /** Languages for speech models: `ru`, `en`, `multi`. */
  languages?: string[];
  prices?: MediaModelPrice[];
  /** The official rate card the prices were copied from. */
  priceSource?: string;
  /** ISO date the rate card was checked. */
  priceCheckedAt?: string;
  /** Provider documentation for this model. */
  docs?: string;
  /** The provider still serves it but no longer recommends it. */
  deprecated?: boolean;
}

/** A unit for people: «изображение», «минута», «1 млн токенов». */
export function mediaPriceUnitTitle(unit: MediaPriceUnit): string {
  switch (unit) {
    case "image":
      return "изображение";
    case "second":
      return "секунда";
    case "minute":
      return "минута";
    case "10k-characters":
      return "10 тыс. символов";
    case "1m-characters":
      return "1 млн символов";
    case "1m-tokens":
      return "1 млн токенов";
    case "request":
      return "запрос";
  }
}

/** A modality for chips: «текст», «изображение», «звук», «видео». */
export function mediaModalityTitle(modality: MediaModality): string {
  switch (modality) {
    case "text":
      return "текст";
    case "image":
      return "изображение";
    case "audio":
      return "звук";
    case "video":
      return "видео";
  }
}

const CURRENCY_SIGNS: Record<string, string> = { USD: "$", EUR: "€", CNY: "¥", RUB: "₽" };

/**
 * A price as one line: `$0.006 / минута`, `$0.04 / изображение (1K)`,
 * `$0.15 / 1 млн токенов (вход)`. The browser and the settings share this formatting.
 */
export function formatMediaPrice(price: MediaModelPrice, locale = "ru-RU"): string {
  const amount = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(price.amount);
  const money = CURRENCY_SIGNS[price.currency]
    ? `${CURRENCY_SIGNS[price.currency]}${amount}`
    : `${amount} ${price.currency}`;
  const unit = mediaPriceUnitTitle(price.unit);
  const side =
    price.appliesTo === "input"
      ? " (вход)"
      : price.appliesTo === "output" || price.appliesTo === "audio-output"
        ? " (выход)"
        : "";
  const variant = price.variant ? ` (${price.variant})` : "";
  return `${money} / ${unit}${variant}${side}${price.estimated ? " · оценка" : ""}`;
}

/** What one media call consumed, as far as the provider or the caller knows it. */
export interface MediaCallUsage {
  /** Audio or video length, for rates per second or per minute. */
  seconds?: number;
  /** Text or audio tokens, for rates per million tokens. */
  inputTokens?: number;
  outputTokens?: number;
}

/** Money of one media call at the model's own rate card. */
export interface MediaCallCost {
  amount: number;
  /** ISO code of the rate card; never mixed with another currency. */
  currency: string;
}

const finite = (value: number | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

/**
 * Money for one call at a published rate. Per-minute and per-second rates need `seconds`;
 * token rates need the token side they bill. A rate card with several currencies, or without
 * the amount a rate bills, stays unpriced: guessing a sum is worse than no sum.
 */
export function mediaCallCost(
  prices: readonly MediaModelPrice[] | undefined,
  usage: MediaCallUsage,
): MediaCallCost | undefined {
  if (!prices?.length) return undefined;
  const currencies = new Set(prices.map((price) => price.currency));
  if (currencies.size !== 1) return undefined;
  const currency = prices[0]!.currency;
  const seconds = finite(usage.seconds);
  const inputTokens = finite(usage.inputTokens);
  const outputTokens = finite(usage.outputTokens);
  let amount = 0;
  let used = false;
  for (const price of prices) {
    if (price.unit === "minute" || price.unit === "second") {
      if (seconds === undefined) return undefined;
      amount += (seconds / (price.unit === "minute" ? 60 : 1)) * price.amount;
      used = true;
      continue;
    }
    if (price.unit !== "1m-tokens") continue;
    const tokens =
      price.appliesTo === "input"
        ? inputTokens
        : price.appliesTo === "output" || price.appliesTo === "audio-output"
          ? outputTokens
          : inputTokens !== undefined || outputTokens !== undefined
            ? (inputTokens ?? 0) + (outputTokens ?? 0)
            : undefined;
    if (tokens === undefined) return undefined;
    amount += (tokens / 1_000_000) * price.amount;
    used = true;
  }
  return used ? { amount, currency } : undefined;
}

/** Что модель принимает и какие значения предлагает форма. */
export interface MediaModelOptions {
  sizes?: string[];
  resolutions?: string[];
  ratios?: string[];
  voices?: string[];
  durations?: number[];
  formats?: string[];
  /** Значения по умолчанию, чтобы клиент не повторял их в каждом запросе. */
  defaults?: Record<string, string | number | boolean>;
}

/** Модель, которую Projector показывает для одного провайдера. */
export interface MediaModel extends MediaModelDetails {
  id: string;
  alias: string;
  capability: MediaCapability;
  providerId: string;
  providerName: string;
  adapter: string;
  title?: string;
  options?: MediaModelOptions;
}

/** Ссылка на входной файл: публичный URL, data URI или base64 без префикса. */
export interface MediaInputSource {
  url?: string;
  base64?: string;
  mime?: string;
}

export interface MediaRequestInput {
  text?: string;
  audio?: MediaInputSource;
  images?: MediaInputSource[];
  video?: MediaInputSource;
}

export interface MediaRequest {
  capability: MediaCapability;
  providerId?: string;
  model: string;
  prompt?: string;
  input?: MediaRequestInput;
  options?: Record<string, unknown>;
}

/** Готовый результат: файл Projector, исходная ссылка или текст распознавания. */
export interface MediaArtifact {
  kind: "image" | "audio" | "video" | "text";
  mime: string;
  /** Идентификатор скачанного файла; ссылка `/api/media/files/{fileId}`. */
  fileId?: string;
  /** Исходная ссылка провайдера. Живёт ограниченное время и не годится для истории. */
  url?: string;
  text?: string;
  expiresAt?: number;
}

export type MediaJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** Единый ответ и для мгновенного результата, и для фоновой задачи. */
export interface MediaJob {
  id: string;
  status: MediaJobStatus;
  capability: MediaCapability;
  providerId: string;
  providerName: string;
  adapter: string;
  model: string;
  artifacts: MediaArtifact[];
  /** Доля выполненной работы от 0 до 1, если провайдер сообщает прогресс. */
  progress?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** Артефакт в ответе агента: та же ссылка файла, но уже готовая для виджета и markdown. */
export interface MediaArtifactView extends MediaArtifact {
  /** Ссылка `/api/media/files/{fileId}`; с `baseUrl` — абсолютная. */
  fileUrl?: string;
}

/** Задача в ответе агента: к артефактам добавлена ссылка и готовый тег виджета. */
export interface MediaJobView extends Omit<MediaJob, "artifacts"> {
  artifacts: MediaArtifactView[];
  /** `<Media jobId="…" />`; описание — через `ide.chat.widgets.describe`. */
  widget?: string;
}

export interface MediaJobViewOptions {
  /** Абсолютный адрес Projector, когда ответ уходит внешнему агенту. */
  baseUrl?: string;
}

/** Одна форма для инструментов агента и MCP: ссылки на файлы и тег, который прочитает виджет. */
export function mediaJobView(job: MediaJob, options: MediaJobViewOptions = {}): MediaJobView {
  const base = options.baseUrl?.replace(/\/+$/, "") ?? "";
  const artifacts = job.artifacts.map((artifact) =>
    artifact.fileId
      ? {
          ...artifact,
          fileUrl: `${base}/api/media/files/${encodeURIComponent(artifact.fileId)}`,
        }
      : artifact,
  );
  return {
    ...job,
    artifacts,
    ...(job.status === "succeeded" && artifacts.length
      ? { widget: `<Media jobId="${job.id}" />` }
      : {}),
  };
}

/** Состояние медиа-подсистемы для настроек и клиента. */
export interface MediaProviderState {
  id: string;
  name: string;
  kind: string;
  capabilities: MediaCapability[];
}

export interface MediaState {
  providers: MediaProviderState[];
  /** Виды провайдеров, для которых зарегистрирован адаптер. */
  adapters: Array<{ kind: string; capabilities: MediaCapability[] }>;
}

export function mediaCapabilityTitle(capability: MediaCapability): string {
  switch (capability) {
    case "image.generate":
      return "Изображения";
    case "speech.synthesize":
      return "Синтез речи";
    case "speech.transcribe":
      return "Распознавание речи";
    case "video.generate":
      return "Видео";
  }
}
