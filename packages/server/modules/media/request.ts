import type { MediaRequest } from "@ai-projector/core/modules/media/index.ts";
import { isMediaCapability } from "@ai-projector/core/modules/media/index.ts";
import { HttpError } from "../http/index.ts";

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function inputSource(value: unknown): { url?: string; base64?: string; mime?: string } | null {
  const item = record(value);
  if (!item) return null;
  const url = text(item.url);
  const base64 = text(item.base64) || text(item.data);
  const mime = text(item.mime) || text(item.contentType);
  if (!url && !base64) return null;
  if (url && !/^https?:\/\//i.test(url))
    throw new HttpError(400, "Ссылка на входной файл должна быть http(s)");
  if (base64.length > 96 * 1024 * 1024) throw new HttpError(413, "Входной файл слишком большой");
  return { ...(url ? { url } : {}), ...(base64 ? { base64 } : {}), ...(mime ? { mime } : {}) };
}

function requestInput(value: unknown): MediaRequest["input"] {
  const item = record(value);
  if (!item) return undefined;
  const audio = inputSource(item.audio);
  const video = inputSource(item.video);
  const images = Array.isArray(item.images)
    ? item.images
        .map(inputSource)
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];
  return {
    ...(text(item.text) ? { text: text(item.text) } : {}),
    ...(audio ? { audio } : {}),
    ...(video ? { video } : {}),
    ...(images.length ? { images } : {}),
  };
}

export function parseRequest(
  body: Record<string, unknown>,
): MediaRequest & { providerId?: string } {
  const capability = body.capability;
  if (!isMediaCapability(capability)) throw new HttpError(400, "Некорректная медиа-возможность");
  const model = text(body.model);
  if (!model) throw new HttpError(400, "Нужно имя модели");
  const input = requestInput(body.input);
  const options = record(body.options) ?? {};
  return {
    capability,
    model,
    ...(text(body.providerId) ? { providerId: text(body.providerId) } : {}),
    ...(text(body.prompt) ? { prompt: text(body.prompt) } : {}),
    ...(input ? { input } : {}),
    ...(Object.keys(options).length ? { options } : {}),
  };
}
