import type {
  MediaCallCost,
  MediaCallUsage,
  MediaRequest,
} from "@ai-projector/core/modules/media/index.ts";
import { HttpError } from "../http/index.ts";
import {
  readAudioSource,
  type MediaAdapter,
  type MediaAdapterModel,
  type MediaProviderContext,
  type MediaSubmission,
} from "../media/index.ts";

/** How long a fetched speech-to-text catalog is reused; the list changes rarely. */
const CATALOG_TTL_MS = 60 * 60 * 1000;

/** Formats the transcription endpoint documents; the model may accept a subset of them. */
const AUDIO_FORMATS = ["wav", "mp3", "flac", "m4a", "ogg", "webm", "aac"] as const;

const FORMAT_BY_MIME: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/aac": "aac",
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const number = (value: unknown): number | undefined => {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
};

/** The API base of an OpenRouter provider: a bare origin means `/api/v1`. */
function openRouterBase(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new HttpError(400, "Некорректный адрес OpenRouter");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new HttpError(400, "Адрес провайдера должен быть http(s)");
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${path || "/api/v1"}`;
}

async function errorText(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const error = record(payload?.error);
  const message = text(error?.message) || text(payload?.message);
  return message || `HTTP ${response.status}`;
}

interface OpenRouterCatalogRow {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  architecture?: unknown;
}

/** One catalog row as a recognition model; rows without the transcription output are skipped. */
function modelOf(value: unknown): MediaAdapterModel | undefined {
  const row = record(value) as OpenRouterCatalogRow | null;
  if (!row) return undefined;
  const id = text(row.id);
  if (!id) return undefined;
  const architecture = record(row.architecture);
  const outputs = Array.isArray(architecture?.output_modalities)
    ? architecture.output_modalities.map(text)
    : [];
  if (!outputs.includes("transcription")) return undefined;
  const description = text(row.description);
  return {
    id,
    alias: id,
    capability: "speech.transcribe",
    title: text(row.name) || id,
    description: description || "Распознавание записанной речи через OpenRouter.",
    input: ["audio"],
    output: ["text"],
    docs: `https://openrouter.ai/${id}`,
    options: { formats: [...AUDIO_FORMATS] },
  };
}

const cache = globalThis as typeof globalThis & {
  projectorOpenRouterMediaCatalog?: {
    at: number;
    base: string;
    models: MediaAdapterModel[];
  };
};

/**
 * The live speech-to-text catalog of OpenRouter. Its main model list omits STT models, so the
 * endpoint has to be asked for the transcription output modality explicitly.
 */
async function openRouterModels(context: MediaProviderContext): Promise<MediaAdapterModel[]> {
  const base = openRouterBase(context.url);
  const now = Date.now();
  const known = cache.projectorOpenRouterMediaCatalog;
  if (known && known.base === base && now - known.at < CATALOG_TTL_MS) return known.models;
  let response: Response;
  try {
    response = await fetch(`${base}/models?output_modalities=transcription`, {
      headers: {
        Accept: "application/json",
        ...(context.apiKey ? { Authorization: `Bearer ${context.apiKey}` } : {}),
      },
      redirect: "error",
      signal: context.signal,
    });
  } catch {
    if (known?.base === base) return known.models;
    throw new HttpError(502, "Не удалось получить каталог распознавания OpenRouter");
  }
  if (!response.ok) {
    const message = await errorText(response);
    if (known?.base === base) return known.models;
    throw new HttpError(
      response.status === 401 || response.status === 429 ? response.status : 502,
      message,
    );
  }
  const payload = (await response.json().catch(() => null)) as { data?: unknown } | null;
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const models = rows
    .map(modelOf)
    .filter((model): model is MediaAdapterModel => model !== undefined);
  // An empty answer is more likely a provider hiccup than a catalog without a single model:
  // retry next time instead of hiding the role's models for an hour.
  if (models.length) cache.projectorOpenRouterMediaCatalog = { at: now, base, models };
  return models;
}

/** The format field the transcription endpoint requires, from the MIME type or the caller. */
function audioFormat(options: Record<string, unknown> | undefined, mime: string): string {
  const requested = typeof options?.format === "string" ? options.format.trim().toLowerCase() : "";
  if ((AUDIO_FORMATS as readonly string[]).includes(requested)) return requested;
  const type = mime.trim().toLowerCase().split(";")[0] ?? "";
  const format = FORMAT_BY_MIME[type];
  if (!format) throw new HttpError(400, "OpenRouter не принимает этот формат аудио");
  return format;
}

/** Duration, tokens and the actual dollar charge of one transcription. */
function transcriptionUsage(payload: Record<string, unknown> | null): {
  usage?: MediaCallUsage;
  cost?: MediaCallCost;
} {
  const reported = record(payload?.usage);
  const seconds = number(reported?.seconds) ?? number(payload?.duration);
  const inputTokens = number(reported?.input_tokens) ?? number(reported?.prompt_tokens);
  const outputTokens = number(reported?.output_tokens) ?? number(reported?.completion_tokens);
  const usage: MediaCallUsage = {
    ...(seconds !== undefined ? { seconds } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
  const amount = number(reported?.cost);
  return {
    ...(Object.keys(usage).length ? { usage } : {}),
    ...(amount !== undefined ? { cost: { amount, currency: "USD" } } : {}),
  };
}

async function submitTranscribe(
  context: MediaProviderContext,
  request: MediaRequest,
): Promise<MediaSubmission> {
  const source = request.input?.audio;
  if (!source) throw new HttpError(400, "Нужен аудиофайл или ссылка для распознавания");
  const { bytes, mime } = await readAudioSource(source);
  const options = request.options;
  const prompt = typeof options?.prompt === "string" ? options.prompt.trim().slice(0, 900) : "";
  const language = typeof options?.language === "string" ? options.language.trim() : "";
  const body = {
    model: request.model,
    input_audio: { data: bytes.toString("base64"), format: audioFormat(options, mime) },
    ...(language ? { language } : {}),
    ...(prompt ? { prompt } : {}),
  };
  let response: Response;
  try {
    response = await fetch(`${openRouterBase(context.url)}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: context.signal,
    });
  } catch {
    throw new HttpError(502, "Не удалось связаться с OpenRouter");
  }
  if (!response.ok) {
    const message = await errorText(response);
    throw new HttpError(
      response.status === 401 || response.status === 429 ? response.status : 502,
      message,
    );
  }
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const transcript = text(payload?.text);
  if (!transcript) throw new HttpError(502, "OpenRouter не вернул текст распознавания");
  return {
    status: "succeeded",
    artifacts: [{ kind: "text", mime: "text/plain", text: transcript }],
    ...transcriptionUsage(payload),
  };
}

/** Speech-to-text through OpenRouter's dedicated `/audio/transcriptions` endpoint. */
export const openRouterMediaAdapter: MediaAdapter = {
  kind: "openrouter",
  capabilities: ["speech.transcribe"],
  requiresKey: true,
  transcriptionPrompt: true,
  listModels: (context) => openRouterModels(context),
  submit(context, request) {
    if (request.capability === "speech.transcribe") return submitTranscribe(context, request);
    throw new HttpError(400, `Адаптер OpenRouter не умеет ${request.capability}`);
  },
};
