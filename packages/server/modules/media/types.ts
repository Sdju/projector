import type {
  MediaCapability,
  MediaJob,
  MediaModelOptions,
  MediaRequest,
} from "@ai-projector/core/modules/media/index.ts";

/** Настройки провайдера, которые получает адаптер; ключ уже расшифрован сервером. */
export interface MediaProviderContext {
  id: string;
  name: string;
  kind: string;
  url: string;
  apiKey: string;
  signal: AbortSignal;
}

/** Модель в терминах адаптера: providerId и adapter добавляет реестр. */
export interface MediaAdapterModel {
  id: string;
  alias?: string;
  capability: MediaCapability;
  title?: string;
  options?: MediaModelOptions;
}

/** Откуда сервис берёт файл, чтобы сохранить его локально. */
export type MediaArtifactSource =
  | { kind: "image" | "audio" | "video"; mime: string; url: string; expiresAt?: number }
  | { kind: "image" | "audio" | "video"; mime: string; base64: string }
  | { kind: "text"; mime: string; text: string };

/** Итог одного шага: готовая вещь, задача, которую надо опрашивать, или ошибка провайдера. */
export interface MediaSubmission {
  status: "running" | "succeeded" | "failed";
  upstreamId?: string;
  artifacts?: MediaArtifactSource[];
  progress?: number;
  error?: string;
}

export interface MediaPollContext {
  job: MediaJob;
  upstreamId: string;
  model: string;
}

/**
 * Адаптер одного вида провайдера. Контракт общий для встроенных провайдеров и (в будущем)
 * доверенных плагинов, поэтому сервис не содержит условий по имени провайдера.
 */
export interface MediaAdapter {
  kind: string;
  capabilities: readonly MediaCapability[];
  /** Без ключа провайдера запрос заведомо не пройдёт. */
  requiresKey?: boolean;
  /** Допустимые хосты скачиваемых результатов; без списка разрешены публичные HTTPS-хосты. */
  artifactHosts?: readonly string[];
  listModels(context: MediaProviderContext): MediaAdapterModel[] | Promise<MediaAdapterModel[]>;
  submit(context: MediaProviderContext, request: MediaRequest): Promise<MediaSubmission>;
  poll?(context: MediaProviderContext, poll: MediaPollContext): Promise<MediaSubmission>;
  cancel?(context: MediaProviderContext, job: MediaJob, upstreamId: string): Promise<void>;
  /** Короткоживущий ключ провайдера для браузера или виджета. */
  temporaryKey?(
    context: MediaProviderContext,
    seconds: number,
  ): Promise<{ token: string; expiresAt: number }>;
}
