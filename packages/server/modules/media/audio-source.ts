import type { MediaInputSource } from "@ai-projector/core/modules/media/index.ts";
import { HttpError } from "../http/index.ts";

/** The same ceiling for input audio and synthesized output; a body over it is refused. */
export const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

/** Reads an audio response body, refusing to buffer more than the audio cap. */
export async function readAudioResponseBytes(response: Response): Promise<Buffer> {
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

/** Downloads or decodes one input recording; MIME comes from the source or the download. */
export async function readAudioSource(source: MediaInputSource): Promise<{
  bytes: Buffer;
  mime: string;
}> {
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
    const bytes = await readAudioResponseBytes(response);
    return { bytes, mime: response.headers.get("content-type")?.split(";")[0] || "audio/mpeg" };
  }
  const raw = source.base64?.trim() ?? "";
  if (!raw) throw new HttpError(400, "Нужен аудиофайл или ссылка");
  const dataUri = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/s.exec(raw);
  const bytes = Buffer.from(dataUri ? dataUri[2]! : raw, "base64");
  if (bytes.length > MAX_AUDIO_BYTES) throw new HttpError(413, "Аудио больше 64 МиБ");
  return { bytes, mime: source.mime || dataUri?.[1] || "audio/mpeg" };
}
