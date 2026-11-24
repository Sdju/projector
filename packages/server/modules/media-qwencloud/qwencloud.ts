import type { MediaInputSource, MediaRequest } from "@ai-projector/core/modules/media/index.ts";
import { HttpError } from "../http/index.ts";
import {
  parseQwenAudio,
  parseQwenImages,
  parseQwenTask,
  parseQwenText,
  parseQwenUsage,
  qwenApiBase,
  qwenErrorText,
} from "./qwencloud-parse.ts";
import { qwencloudModels } from "./qwencloud-models.ts";
import type { MediaAdapter, MediaProviderContext, MediaSubmission } from "../media/index.ts";

const MULTIMODAL = "/services/aigc/multimodal-generation/generation";
const IMAGE_ASYNC = "/services/aigc/image-generation/generation";
const VIDEO = "/services/aigc/video-generation/video-synthesis";

type Options = Record<string, unknown> | undefined;

const optionString = (options: Options, key: string): string =>
  typeof options?.[key] === "string" ? (options[key] as string).trim() : "";

const optionNumber = (options: Options, key: string): number | undefined => {
  const value = options?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const optionBoolean = (options: Options, key: string): boolean | undefined =>
  typeof options?.[key] === "boolean" ? (options[key] as boolean) : undefined;

function imageSize(value: string): string {
  return /^\d+x\d+$/.test(value) ? value.replace("x", "*") : value;
}

function dataUri(source: MediaInputSource): string {
  const base64 = source.base64?.trim() ?? "";
  if (!base64) return source.url?.trim() ?? "";
  if (base64.startsWith("data:")) return base64;
  return `data:${source.mime?.trim() || "audio/wav"};base64,${base64}`;
}

/** Запрос к DashScope с разбором ошибки; 4xx сохраняет статус, 5xx превращается в 502. */
async function qwenRequest(
  context: MediaProviderContext,
  path: string,
  init: { method?: string; body?: unknown; async?: boolean },
): Promise<{ response: Response; payload: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${qwenApiBase(context.url)}${path}`, {
      method: init.method ?? "POST",
      headers: {
        Authorization: `Bearer ${context.apiKey}`,
        "Content-Type": "application/json",
        ...(init.async ? { "X-DashScope-Async": "enable" } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "error",
      signal: context.signal,
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "Не удалось связаться с QwenCloud");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const status =
      response.status === 401 || response.status === 403 || response.status === 429
        ? response.status
        : response.status === 400
          ? 400
          : 502;
    // A 401 usually means the key belongs to another region, not that it is wrong.
    const hint =
      response.status === 401 || response.status === 403
        ? " — проверьте, что ключ создан в регионе адреса провайдера"
        : "";
    throw new HttpError(
      status,
      `QwenCloud: ${qwenErrorText(payload, `HTTP ${response.status}`)}${hint}`,
    );
  }
  const payload = await response.json().catch(() => null);
  if (payload === null) throw new HttpError(502, "QwenCloud вернул некорректный JSON");
  return { response, payload };
}

function imageContent(request: MediaRequest): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  for (const source of request.input?.images ?? []) {
    const value = dataUri(source);
    if (value) content.push({ image: value });
  }
  const prompt = request.prompt?.trim() || request.input?.text?.trim() || "";
  if (prompt) content.push({ text: prompt });
  return content;
}

async function submitImage(
  context: MediaProviderContext,
  request: MediaRequest,
): Promise<MediaSubmission> {
  const content = imageContent(request);
  if (!content.some((item) => typeof item.text === "string"))
    throw new HttpError(400, "Нужен prompt для генерации изображения");
  const options = request.options;
  const parameters: Record<string, unknown> = {};
  const size = optionString(options, "size");
  if (size) parameters.size = imageSize(size);
  const negative =
    optionString(options, "negative_prompt") || optionString(options, "negativePrompt");
  if (negative) parameters.negative_prompt = negative;
  const n = optionNumber(options, "n");
  if (n) parameters.n = Math.max(1, Math.min(6, Math.round(n)));
  const promptExtend =
    optionBoolean(options, "prompt_extend") ?? optionBoolean(options, "promptExtend");
  if (promptExtend !== undefined) parameters.prompt_extend = promptExtend;
  const watermark = optionBoolean(options, "watermark");
  if (watermark !== undefined) parameters.watermark = watermark;
  const seed = optionNumber(options, "seed");
  if (seed !== undefined) parameters.seed = Math.max(0, Math.round(seed));

  const runAsync = optionBoolean(options, "async") === true;
  const body = {
    model: request.model,
    input: { messages: [{ role: "user", content }] },
    parameters,
  };
  const { payload } = await qwenRequest(context, runAsync ? IMAGE_ASYNC : MULTIMODAL, {
    body,
    async: runAsync,
  });
  if (runAsync) {
    const taskId = qwenTaskId(payload);
    if (!taskId) throw new HttpError(502, "QwenCloud не вернул идентификатор задачи");
    return { status: "running", upstreamId: taskId };
  }
  const artifacts = parseQwenImages(payload);
  if (!artifacts.length)
    throw new HttpError(
      502,
      `QwenCloud не вернул изображение: ${qwenErrorText(payload, "пустой ответ")}`,
    );
  return { status: "succeeded", artifacts };
}

async function submitSpeech(
  context: MediaProviderContext,
  request: MediaRequest,
): Promise<MediaSubmission> {
  const text = request.input?.text?.trim() || request.prompt?.trim() || "";
  if (!text) throw new HttpError(400, "Нужен текст для синтеза речи");
  const options = request.options;
  const body = {
    model: request.model,
    input: {
      text,
      ...(optionString(options, "voice") ? { voice: optionString(options, "voice") } : {}),
      ...(optionString(options, "language_type") || optionString(options, "language")
        ? {
            language_type:
              optionString(options, "language_type") || optionString(options, "language"),
          }
        : {}),
      ...(optionString(options, "format") ? { format: optionString(options, "format") } : {}),
    },
  };
  const { payload } = await qwenRequest(context, MULTIMODAL, { body });
  const audio = parseQwenAudio(payload);
  if (!audio)
    throw new HttpError(
      502,
      `QwenCloud не вернул аудио: ${qwenErrorText(payload, "пустой ответ")}`,
    );
  return { status: "succeeded", artifacts: [audio] };
}

async function submitTranscribe(
  context: MediaProviderContext,
  request: MediaRequest,
): Promise<MediaSubmission> {
  const source = request.input?.audio;
  if (!source) throw new HttpError(400, "Нужен аудиофайл или ссылка для распознавания");
  if (optionBoolean(request.options, "async") === true)
    throw new HttpError(400, "Фоновое распознавание пока не поддерживается");
  const data = dataUri(source);
  if (!data) throw new HttpError(400, "Пустой аудиофайл");
  const mimeFormat = source.mime?.trim().toLowerCase().split("/")[1] ?? "";
  const audioFormat =
    optionString(request.options, "format") ||
    (mimeFormat === "x-wav" ? "wav" : mimeFormat === "mpeg" ? "mp3" : mimeFormat) ||
    "wav";
  const body = {
    model: request.model,
    input: {
      messages: [
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { data } }],
        },
      ],
    },
    parameters: {
      format: audioFormat,
      ...(optionString(request.options, "sample_rate")
        ? { sample_rate: optionString(request.options, "sample_rate") }
        : {}),
    },
  };
  const { payload } = await qwenRequest(context, MULTIMODAL, { body });
  const transcript = parseQwenText(payload);
  if (!transcript)
    throw new HttpError(
      502,
      `QwenCloud не вернул текст: ${qwenErrorText(payload, "пустой ответ")}`,
    );
  const usage = parseQwenUsage(payload);
  return {
    status: "succeeded",
    artifacts: [{ kind: "text", mime: "text/plain", text: transcript }],
    ...(usage ? { usage } : {}),
  };
}

async function submitVideo(
  context: MediaProviderContext,
  request: MediaRequest,
): Promise<MediaSubmission> {
  const prompt = request.prompt?.trim() || request.input?.text?.trim() || "";
  if (!prompt) throw new HttpError(400, "Нужен prompt для генерации видео");
  const options = request.options;
  const parameters: Record<string, unknown> = {};
  const resolution = optionString(options, "resolution");
  if (resolution) parameters.resolution = resolution;
  const ratio = optionString(options, "ratio");
  if (ratio) parameters.ratio = ratio;
  const size = optionString(options, "size");
  if (size) parameters.size = imageSize(size);
  const duration = optionNumber(options, "duration");
  if (duration) parameters.duration = Math.round(duration);
  const promptExtend =
    optionBoolean(options, "prompt_extend") ?? optionBoolean(options, "promptExtend");
  if (promptExtend !== undefined) parameters.prompt_extend = promptExtend;
  const watermark = optionBoolean(options, "watermark");
  if (watermark !== undefined) parameters.watermark = watermark;
  const seed = optionNumber(options, "seed");
  if (seed !== undefined) parameters.seed = Math.max(0, Math.round(seed));
  const shotType = optionString(options, "shot_type");
  if (shotType) parameters.shot_type = shotType;

  const image = request.input?.images?.[0];
  const imageUrl = image ? image.url?.trim() || dataUri(image) : "";
  const audioUrl = request.input?.audio?.url?.trim() ?? "";
  const body = {
    model: request.model,
    input: {
      prompt,
      ...(imageUrl ? { img_url: imageUrl } : {}),
      ...(audioUrl ? { audio_url: audioUrl } : {}),
    },
    parameters,
  };
  const { payload } = await qwenRequest(context, VIDEO, { body, async: true });
  const taskId = qwenTaskId(payload);
  if (!taskId) throw new HttpError(502, "QwenCloud не вернул идентификатор задачи");
  return { status: "running", upstreamId: taskId };
}

function qwenTaskId(payload: unknown): string {
  const root = payload as Record<string, unknown> | null;
  const output = (root?.output ?? root) as Record<string, unknown> | null;
  const id = output?.task_id ?? root?.task_id;
  return typeof id === "string" ? id.trim() : "";
}

async function pollTask(
  context: MediaProviderContext,
  upstreamId: string,
): Promise<MediaSubmission> {
  const { payload } = await qwenRequest(context, `/tasks/${encodeURIComponent(upstreamId)}`, {
    method: "GET",
  });
  const task = parseQwenTask(payload);
  if (task.status === "failed")
    return {
      status: "failed",
      upstreamId,
      error: task.error ?? "Задача QwenCloud упала",
    };
  if (task.status === "running")
    return {
      status: "running",
      upstreamId,
      ...(task.progress !== undefined ? { progress: task.progress } : {}),
    };
  const artifacts = task.artifacts ?? [];
  if (!artifacts.length) throw new HttpError(502, "QwenCloud не вернул результат задачи");
  return { status: "succeeded", upstreamId, artifacts };
}

async function cancelTask(context: MediaProviderContext, upstreamId: string): Promise<void> {
  await qwenRequest(context, `/tasks/${encodeURIComponent(upstreamId)}/cancel`, { method: "POST" });
}

export const qwencloudAdapter: MediaAdapter = {
  kind: "qwencloud",
  capabilities: ["image.generate", "speech.synthesize", "speech.transcribe", "video.generate"],
  requiresKey: true,
  artifactHosts: ["aliyuncs.com", "qwencloudapi.com"],
  listModels: () => qwencloudModels(),
  submit(context, request) {
    switch (request.capability) {
      case "image.generate":
        return submitImage(context, request);
      case "speech.synthesize":
        return submitSpeech(context, request);
      case "speech.transcribe":
        return submitTranscribe(context, request);
      case "video.generate":
        return submitVideo(context, request);
    }
  },
  poll(context, poll) {
    return pollTask(context, poll.upstreamId);
  },
  cancel(context, _job, upstreamId) {
    return cancelTask(context, upstreamId);
  },
  temporaryKey(context, seconds) {
    return qwencloudTemporaryKey(context, seconds);
  },
};

/** Временный ключ `st-…`; живёт от 1 до 1800 секунд и наследует права исходного ключа. */
export async function qwencloudTemporaryKey(
  context: MediaProviderContext,
  seconds: number,
): Promise<{ token: string; expiresAt: number }> {
  const ttl = Math.max(1, Math.min(1800, Math.round(seconds)));
  const { payload } = await qwenRequest(context, `/tokens?expire_in_seconds=${ttl}`, {
    method: "POST",
  });
  const record = payload as Record<string, unknown> | null;
  const token = typeof record?.token === "string" ? record.token.trim() : "";
  const expiresAt = typeof record?.expires_at === "number" ? record.expires_at : 0;
  if (!token) throw new HttpError(502, "QwenCloud не вернул временный ключ");
  return { token, expiresAt };
}
