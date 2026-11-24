import { qwenCloudEndpoint } from "@ai-projector/core/modules/providers/index.ts";
import type { MediaCallUsage } from "@ai-projector/core/modules/media/index.ts";
import type { MediaArtifactSource } from "../media/index.ts";

type Dict = Record<string, unknown>;

export const asRecord = (value: unknown): Dict | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * База DashScope: принимает новый домен QwenCloud, старый DashScope и полный URL с путём API.
 * Возвращает origin без пути; пути `/api/v1` и `/compatible-mode/v1` строятся отдельно.
 */
export function normalizeQwenCloudOrigin(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("Некорректный адрес провайдера QwenCloud");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new Error("Адрес провайдера QwenCloud должен быть http(s)");
  return `${parsed.protocol}//${parsed.host}`;
}

export function qwenApiBase(url: string): string {
  return qwenCloudEndpoint(url).apiBase;
}

/** Ошибка провайдера в одном сообщении: код, текст и request_id для поддержки. */
export function qwenErrorText(payload: unknown, fallback: string): string {
  const root = asRecord(payload);
  const output = asRecord(root?.output);
  const code = text(root?.code) || text(output?.code);
  const message = text(root?.message) || text(output?.message);
  const requestId = text(root?.request_id) || text(output?.request_id);
  if (!message && !code) return fallback;
  const head = [code, message].filter(Boolean).join(": ");
  return requestId ? `${head} (request_id ${requestId})` : head;
}

function imageFromUrl(url: string): MediaArtifactSource {
  return { kind: "image", mime: "image/png", url };
}

function imagesFromContainer(value: unknown, out: MediaArtifactSource[]): void {
  for (const item of asArray(value)) {
    const record = asRecord(item);
    if (!record) continue;
    const url = text(record.url) || text(record.image) || text(record.image_url);
    if (url) out.push(imageFromUrl(url));
  }
}

/** Все изображения ответа: синхронный multimodal, async-результат и OpenAI-подобная форма. */
export function parseQwenImages(payload: unknown): MediaArtifactSource[] {
  const root = asRecord(payload);
  const output = asRecord(root?.output) ?? root;
  const out: MediaArtifactSource[] = [];
  for (const choice of asArray(output?.choices)) {
    const content = asRecord(choice)?.message;
    for (const part of asArray(asRecord(content)?.content)) {
      const record = asRecord(part);
      if (!record) continue;
      const url = text(record.image) || text(record.image_url) || text(record.url);
      if (url) out.push(imageFromUrl(url));
      imagesFromContainer(record.images, out);
    }
  }
  imagesFromContainer(output?.results, out);
  imagesFromContainer(output?.images, out);
  imagesFromContainer(output?.data, out);
  if (text(output?.image_url)) out.push(imageFromUrl(text(output?.image_url)));
  if (text(output?.url) && out.length === 0) out.push(imageFromUrl(text(output?.url)));
  return out;
}

/** Аудио ответа: URL или base64 в `output.audio`. */
export function parseQwenAudio(payload: unknown): MediaArtifactSource | null {
  const root = asRecord(payload);
  const output = asRecord(root?.output) ?? root;
  const audio = asRecord(output?.audio);
  const url =
    text(audio?.url) ||
    text(output?.audio_url) ||
    text(audio?.audio_url) ||
    text(output?.url) ||
    text(asRecord(asArray(output?.choices)[0])?.url);
  const expiresAt =
    number(audio?.expires_at) ?? number(output?.expires_at) ?? number(root?.expires_at);
  if (url) return { kind: "audio", mime: "audio/mpeg", url, ...(expiresAt ? { expiresAt } : {}) };
  const base64 = text(audio?.data) || text(output?.audio_data);
  if (base64) return { kind: "audio", mime: "audio/mpeg", base64 };
  for (const choice of asArray(output?.choices)) {
    const message = asRecord(asRecord(choice)?.message);
    for (const part of asArray(message?.content)) {
      const record = asRecord(part);
      const partUrl = text(record?.audio) || text(asRecord(record?.audio)?.url);
      if (partUrl) return { kind: "audio", mime: "audio/mpeg", url: partUrl };
      const bytes = text(asRecord(record?.audio)?.data);
      if (bytes) return { kind: "audio", mime: "audio/mpeg", base64: bytes };
    }
  }
  return null;
}

/** Текст распознавания: `output.text`, `output.transcription` или content ассистента. */
export function parseQwenText(payload: unknown): string | null {
  const root = asRecord(payload);
  const output = asRecord(root?.output) ?? root;
  const direct = text(output?.text) || text(output?.transcription) || text(output?.transcript);
  if (direct) return direct;
  for (const choice of asArray(output?.choices)) {
    const message = asRecord(asRecord(choice)?.message);
    const content = message?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    for (const part of asArray(content)) {
      const record = asRecord(part);
      const value = text(record?.text) || text(record?.transcription);
      if (value) return value;
    }
  }
  return null;
}

/** Токены распознавания, если ответ их сообщает: `usage.input_tokens` и `output_tokens`. */
export function parseQwenUsage(payload: unknown): MediaCallUsage | undefined {
  const root = asRecord(payload);
  const usage =
    asRecord(root?.usage) ?? asRecord(asRecord(root?.output)?.usage) ?? asRecord(root?.data);
  if (!usage) return undefined;
  const inputTokens = number(usage.input_tokens) ?? number(usage.prompt_tokens);
  const outputTokens = number(usage.output_tokens) ?? number(usage.completion_tokens);
  const result: MediaCallUsage = {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
  return Object.keys(result).length ? result : undefined;
}

export interface QwenTaskResult {
  status: "running" | "succeeded" | "failed";
  upstreamId?: string;
  artifacts?: MediaArtifactSource[];
  progress?: number;
  error?: string;
}

/** Ответ `GET /tasks/{id}`: статус, видео или изображения, текст ошибки. */
export function parseQwenTask(payload: unknown): QwenTaskResult {
  const root = asRecord(payload);
  const output = asRecord(root?.output) ?? root;
  const status = text(output?.task_status).toUpperCase();
  const upstreamId = text(output?.task_id) || text(root?.task_id);
  const rawProgress = number(output?.task_progress) ?? number(root?.task_progress);
  const progress =
    rawProgress === undefined
      ? undefined
      : Math.max(0, Math.min(1, rawProgress > 1 ? rawProgress / 100 : rawProgress));
  if (status === "FAILED" || status === "CANCELED" || status === "CANCELLED")
    return {
      status: "failed",
      ...(upstreamId ? { upstreamId } : {}),
      error: qwenErrorText(payload, "Задача QwenCloud завершилась ошибкой"),
    };
  if (status === "SUCCEEDED" || status === "SUCCESS" || status === "COMPLETED") {
    const videoUrl =
      text(output?.video_url) || text(asRecord(output?.video)?.url) || text(output?.url);
    if (videoUrl)
      return {
        status: "succeeded",
        ...(upstreamId ? { upstreamId } : {}),
        artifacts: [{ kind: "video", mime: "video/mp4", url: videoUrl }],
      };
    const images = parseQwenImages(payload);
    if (images.length)
      return {
        status: "succeeded",
        ...(upstreamId ? { upstreamId } : {}),
        artifacts: images,
      };
    const transcript = parseQwenText(payload);
    if (transcript)
      return {
        status: "succeeded",
        ...(upstreamId ? { upstreamId } : {}),
        artifacts: [{ kind: "text", mime: "text/plain", text: transcript }],
      };
    return {
      status: "failed",
      ...(upstreamId ? { upstreamId } : {}),
      error: "QwenCloud не вернул результат задачи",
    };
  }
  return {
    status: "running",
    ...(upstreamId ? { upstreamId } : {}),
    ...(progress !== undefined ? { progress } : {}),
  };
}
