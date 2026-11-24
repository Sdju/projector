import type { MediaCallUsage, MediaRequest } from "@ai-projector/core/modules/media/index.ts";
import { HttpError } from "../http/index.ts";
import type {
  MediaAdapter,
  MediaAdapterModel,
  MediaArtifactSource,
  MediaProviderContext,
  MediaSubmission,
} from "../media/index.ts";

const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

async function responseBytes(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES) {
    await response.body?.cancel();
    throw new HttpError(413, "Аудио больше 64 МиБ");
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_AUDIO_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "Аудио больше 64 МиБ");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

function openAiBase(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new HttpError(400, "Некорректный адрес OpenAI-совместимого провайдера");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new HttpError(400, "Адрес провайдера должен быть http(s)");
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${path || "/v1"}`;
}

/** The rate card these prices were copied from; shown next to them in the settings. */
const PRICE_SOURCE = "https://platform.openai.com/docs/pricing";
const CHECKED_AT = "2026-11-23";

/**
 * The OpenAI-compatible catalog: only what this adapter knows how to call and what the official
 * rate card states. `gpt-image-1` and `dall-e-3` are kept for existing setups but have no price
 * line on the current card, so they honestly carry none.
 */
function models(): MediaAdapterModel[] {
  return [
    {
      id: "gpt-image-1",
      capability: "image.generate",
      title: "GPT Image 1",
      description:
        "Генерация и правка изображений по тексту: держит композицию и надписи лучше DALL·E. Тарифа на текущей странице цен нет.",
      input: ["text", "image"],
      output: ["image"],
      docs: "https://platform.openai.com/docs/guides/image-generation",
      options: { sizes: ["1024x1024", "1536x1024", "1024x1536"], defaults: { n: 1 } },
    },
    {
      id: "dall-e-3",
      capability: "image.generate",
      title: "DALL·E 3",
      description:
        "Генерация одного изображения по подробному описанию. Проще в композиции, чем GPT Image; цены на текущей странице нет.",
      input: ["text"],
      output: ["image"],
      docs: "https://platform.openai.com/docs/guides/image-generation",
      options: { sizes: ["1024x1024", "1792x1024", "1024x1792"], defaults: { n: 1 } },
    },
    {
      id: "gpt-4o-mini-tts",
      capability: "speech.synthesize",
      title: "GPT-4o mini TTS",
      description:
        "Синтез речи с управлением голосом и стилем; тариф по токенам, поэтому длинная фраза стоит дороже короткой.",
      input: ["text"],
      output: ["audio"],
      languages: ["multi"],
      prices: [
        { amount: 12, currency: "USD", unit: "1m-tokens", appliesTo: "audio-output" },
        { amount: 0.6, currency: "USD", unit: "1m-tokens", appliesTo: "input" },
      ],
      priceSource: PRICE_SOURCE,
      priceCheckedAt: CHECKED_AT,
      docs: "https://platform.openai.com/docs/guides/text-to-speech",
      options: {
        voices: [
          "alloy",
          "ash",
          "ballad",
          "coral",
          "echo",
          "fable",
          "nova",
          "onyx",
          "sage",
          "shimmer",
        ],
        defaults: { voice: "alloy" },
      },
    },
    {
      id: "tts-1",
      capability: "speech.synthesize",
      title: "OpenAI TTS 1",
      description:
        "Базовый синтез речи с предсказуемой ценой за символ; подходит для озвучки ответов и подкастов.",
      input: ["text"],
      output: ["audio"],
      languages: ["multi"],
      prices: [{ amount: 15, currency: "USD", unit: "1m-characters" }],
      priceSource: PRICE_SOURCE,
      priceCheckedAt: CHECKED_AT,
      docs: "https://platform.openai.com/docs/guides/text-to-speech",
      options: {
        voices: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
        defaults: { voice: "alloy" },
      },
    },
    {
      id: "whisper-1",
      capability: "speech.transcribe",
      title: "Whisper 1",
      description:
        "Распознавание речи и перевод на английский; устойчив к шуму, но медленнее новых моделей.",
      input: ["audio"],
      output: ["text"],
      languages: ["multi"],
      prices: [{ amount: 0.006, currency: "USD", unit: "minute" }],
      priceSource: PRICE_SOURCE,
      priceCheckedAt: CHECKED_AT,
      docs: "https://platform.openai.com/docs/guides/speech-to-text",
      options: { formats: ["mp3", "wav", "m4a", "webm", "ogg"] },
    },
    {
      id: "gpt-4o-mini-transcribe",
      capability: "speech.transcribe",
      title: "GPT-4o mini Transcribe",
      description:
        "Быстрое распознавание без перевода; дешевле Whisper и лучше держит пунктуацию. Цена — оценка провайдера за минуту.",
      input: ["audio"],
      output: ["text"],
      languages: ["multi"],
      prices: [{ amount: 0.003, currency: "USD", unit: "minute", estimated: true }],
      priceSource: PRICE_SOURCE,
      priceCheckedAt: CHECKED_AT,
      docs: "https://platform.openai.com/docs/guides/speech-to-text",
      options: { formats: ["mp3", "wav", "m4a", "webm", "ogg"] },
    },
  ];
}

async function errorText(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const error = payload?.error as Record<string, unknown> | undefined;
  const message =
    (typeof error?.message === "string" ? error.message : "") ||
    (typeof payload?.message === "string" ? payload.message : "");
  return message || `HTTP ${response.status}`;
}

async function postJson(
  context: MediaProviderContext,
  path: string,
  body: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${openAiBase(context.url)}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${context.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: context.signal,
    });
  } catch {
    throw new HttpError(502, "Не удалось связаться с провайдером");
  }
  if (!response.ok) {
    const message = await errorText(response);
    throw new HttpError(
      response.status === 401 || response.status === 429 ? response.status : 502,
      message,
    );
  }
  return response.json();
}

function imageArtifacts(payload: unknown): MediaArtifactSource[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const out: MediaArtifactSource[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.url === "string" && record.url.trim())
      out.push({ kind: "image", mime: "image/png", url: record.url.trim() });
    else if (typeof record.b64_json === "string" && record.b64_json.trim())
      out.push({ kind: "image", mime: "image/png", base64: record.b64_json.trim() });
  }
  return out;
}

async function submitImage(
  context: MediaProviderContext,
  request: MediaRequest,
): Promise<MediaSubmission> {
  const prompt = request.prompt?.trim() || request.input?.text?.trim() || "";
  if (!prompt) throw new HttpError(400, "Нужен prompt для генерации изображения");
  const options = request.options ?? {};
  const size = typeof options.size === "string" ? options.size : "";
  const n = typeof options.n === "number" ? Math.max(1, Math.min(4, Math.round(options.n))) : 1;
  const payload = await postJson(context, "/images/generations", {
    model: request.model,
    prompt,
    n,
    ...(size ? { size } : {}),
  });
  const artifacts = imageArtifacts(payload);
  if (!artifacts.length) throw new HttpError(502, "Провайдер не вернул изображение");
  return { status: "succeeded", artifacts };
}

async function submitSpeech(
  context: MediaProviderContext,
  request: MediaRequest,
): Promise<MediaSubmission> {
  const text = request.input?.text?.trim() || request.prompt?.trim() || "";
  if (!text) throw new HttpError(400, "Нужен текст для синтеза речи");
  const options = request.options ?? {};
  const response = await fetch(`${openAiBase(context.url)}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${context.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: request.model,
      input: text,
      voice: typeof options.voice === "string" ? options.voice : "alloy",
      response_format: typeof options.format === "string" ? options.format : "mp3",
    }),
    redirect: "error",
    signal: context.signal,
  }).catch(() => {
    throw new HttpError(502, "Не удалось связаться с провайдером");
  });
  if (!response.ok) {
    const message = await errorText(response);
    throw new HttpError(
      response.status === 401 || response.status === 429 ? response.status : 502,
      message,
    );
  }
  const bytes = await responseBytes(response);
  if (!bytes.length) throw new HttpError(502, "Провайдер вернул пустое аудио");
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim() || "audio/mpeg";
  return {
    status: "succeeded",
    artifacts: [{ kind: "audio", mime, base64: bytes.toString("base64") }],
  };
}

async function readAudioSource(source: {
  url?: string;
  base64?: string;
  mime?: string;
}): Promise<{ bytes: Buffer; mime: string }> {
  if (source.url?.trim()) {
    let response: Response;
    try {
      response = await fetch(source.url.trim(), {
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new HttpError(502, "Не удалось скачать аудио для распознавания");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(502, `Аудио недоступно: HTTP ${response.status}`);
    }
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_AUDIO_BYTES) {
      await response.body?.cancel();
      throw new HttpError(413, "Аудио больше 64 МиБ");
    }
    const bytes = await responseBytes(response);
    if (bytes.length > MAX_AUDIO_BYTES) throw new HttpError(413, "Аудио больше 64 МиБ");
    return { bytes, mime: response.headers.get("content-type")?.split(";")[0] || "audio/mpeg" };
  }
  const base64 = source.base64?.trim() ?? "";
  if (!base64) throw new HttpError(400, "Нужен аудиофайл или ссылка");
  const bytes = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ""), "base64");
  if (bytes.length > MAX_AUDIO_BYTES) throw new HttpError(413, "Аудио больше 64 МиБ");
  return { bytes, mime: source.mime || "audio/mpeg" };
}

/** Tokens and duration an OpenAI-compatible transcription response may report. */
function transcriptionUsage(payload: Record<string, unknown> | null): MediaCallUsage | undefined {
  const usage =
    payload?.usage && typeof payload.usage === "object"
      ? (payload.usage as Record<string, unknown>)
      : undefined;
  const number = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
  const inputTokens = number(usage?.input_tokens) ?? number(usage?.prompt_tokens);
  const outputTokens = number(usage?.output_tokens) ?? number(usage?.completion_tokens);
  const seconds = number(payload?.duration);
  const result: MediaCallUsage = {
    ...(seconds !== undefined ? { seconds } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
  return Object.keys(result).length ? result : undefined;
}

async function submitTranscribe(
  context: MediaProviderContext,
  request: MediaRequest,
): Promise<MediaSubmission> {
  const source = request.input?.audio;
  if (!source) throw new HttpError(400, "Нужен аудиофайл или ссылка");
  const { bytes, mime } = await readAudioSource(source);
  const form = new FormData();
  form.append("model", request.model);
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), "audio");
  if (typeof request.options?.language === "string")
    form.append("language", request.options.language);
  // A hint of names and terms, not instructions: OpenAI-compatible endpoints accept free text.
  if (typeof request.options?.prompt === "string") {
    const prompt = request.options.prompt.trim().slice(0, 900);
    if (prompt) form.append("prompt", prompt);
  }
  let response: Response;
  try {
    response = await fetch(`${openAiBase(context.url)}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${context.apiKey}` },
      body: form,
      redirect: "error",
      signal: context.signal,
    });
  } catch {
    throw new HttpError(502, "Не удалось связаться с провайдером");
  }
  if (!response.ok) {
    const message = await errorText(response);
    throw new HttpError(
      response.status === 401 || response.status === 429 ? response.status : 502,
      message,
    );
  }
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) throw new HttpError(502, "Провайдер не вернул текст");
  const usage = transcriptionUsage(payload);
  return {
    status: "succeeded",
    artifacts: [{ kind: "text", mime: "text/plain", text }],
    ...(usage ? { usage } : {}),
  };
}

/** OpenAI-совместимые медиа-модели: изображения, TTS и распознавание. */
export const openAiMediaAdapter: MediaAdapter = {
  kind: "custom",
  capabilities: ["image.generate", "speech.synthesize", "speech.transcribe"],
  transcriptionPrompt: true,
  listModels: () => models(),
  submit(context, request) {
    switch (request.capability) {
      case "image.generate":
        return submitImage(context, request);
      case "speech.synthesize":
        return submitSpeech(context, request);
      case "speech.transcribe":
        return submitTranscribe(context, request);
      case "video.generate":
        throw new HttpError(400, "OpenAI-совместимый адаптер не поддерживает видео");
    }
  },
};
