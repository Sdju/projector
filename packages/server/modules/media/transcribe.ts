import {
  mediaCallCost,
  type MediaCallCost,
  type MediaCallUsage,
  type MediaRequest,
} from "@ai-projector/core/modules/media/index.ts";
import { HttpError } from "../http/index.ts";
import { providerContext, resolveMediaProvider } from "./provider.ts";

const TRANSCRIBE_TIMEOUT_MS = 2 * 60 * 1000;

export interface MediaTranscription {
  text: string;
  providerId: string;
  providerName: string;
  model: string;
  contextSent: boolean;
  /** Seconds or tokens the call consumed, when known. */
  usage: MediaCallUsage;
  /** Money at the model's published rate; absent when the rate card or usage is unknown. */
  cost?: MediaCallCost;
}

/**
 * Length of a PCM WAV recording from its header: `data` size divided by the byte rate. Other
 * formats stay unmeasured, and a broken header is not a guess.
 */
export function wavDurationSeconds(base64: string, mime: string): number | undefined {
  const type = mime.trim().toLowerCase();
  if (type !== "audio/wav" && type !== "audio/x-wav" && type !== "audio/wave") return undefined;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < 44) return undefined;
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE")
    return undefined;
  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const dataAt = offset + 8;
    if (id === "fmt " && size >= 16 && dataAt + 16 <= bytes.length)
      byteRate = bytes.readUInt32LE(dataAt + 8);
    if (id === "data") {
      if (!byteRate) return undefined;
      const available = Math.max(0, bytes.length - dataAt);
      const length = size === 0xffffffff ? available : Math.min(size, available);
      return length ? length / byteRate : undefined;
    }
    offset = dataAt + size + (size % 2);
  }
  return undefined;
}

/** One recording read by a media model, without a job or a saved artifact: the caller keeps the
 * text and the audio is dropped. `prompt` is a hint for the model (names and terms), not
 * instructions, and only adapters that support it send it upstream.
 */
export async function transcribeMedia(input: {
  providerId?: string | undefined;
  model: string;
  audio: { base64: string; mime: string };
  prompt?: string | undefined;
  language?: string | undefined;
}): Promise<MediaTranscription> {
  const { adapter, provider } = await resolveMediaProvider(input.providerId);
  if (!adapter.capabilities.includes("speech.transcribe"))
    throw new HttpError(400, `Адаптер «${adapter.kind}» не умеет распознавать речь`);
  const request: MediaRequest = {
    capability: "speech.transcribe",
    model: input.model,
    input: { audio: { base64: input.audio.base64, mime: input.audio.mime } },
    options: {
      ...(input.audio.mime === "audio/wav" || input.audio.mime === "audio/x-wav"
        ? { format: "wav", sample_rate: "16000" }
        : {}),
      ...(input.language ? { language: input.language } : {}),
      ...(input.prompt ? { prompt: input.prompt } : {}),
    },
  };
  const submission = await adapter.submit(
    providerContext(
      provider.id,
      provider.name,
      provider.kind,
      provider.url,
      provider.apiKey,
      AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    ),
    request,
  );
  if (submission.status === "failed")
    throw new HttpError(502, submission.error || "Провайдер отказал в распознавании");
  if (submission.status !== "succeeded")
    throw new HttpError(502, "Провайдер вернул фоновую задачу вместо текста");
  let text = "";
  for (const artifact of submission.artifacts ?? [])
    if (artifact.kind === "text") text = artifact.text.trim();
  if (!text) throw new HttpError(502, "Провайдер не вернул текст распознавания");
  const seconds =
    submission.usage?.seconds ?? wavDurationSeconds(input.audio.base64, input.audio.mime);
  const usage: MediaCallUsage = {
    ...submission.usage,
    ...(seconds !== undefined ? { seconds } : {}),
  };
  // An actual charge beats a rate-card estimate: OpenRouter reports `usage.cost` per call.
  let cost: MediaCallCost | undefined = submission.cost;
  if (!cost) {
    try {
      const models = await adapter.listModels(
        providerContext(provider.id, provider.name, provider.kind, provider.url, ""),
      );
      const known = models.find((model) => model.id === input.model || model.alias === input.model);
      cost = mediaCallCost(known?.prices, usage);
    } catch {
      // A missing rate card leaves the call unpriced; the text is what the caller asked for.
    }
  }
  return {
    text,
    providerId: provider.id,
    providerName: provider.name,
    model: input.model,
    contextSent: Boolean(input.prompt?.trim() && adapter.transcriptionPrompt),
    usage,
    ...(cost ? { cost } : {}),
  };
}
