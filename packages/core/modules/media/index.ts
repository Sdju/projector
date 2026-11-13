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
export interface MediaModel {
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
