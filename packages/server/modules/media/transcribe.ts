import type { MediaRequest } from "@ai-projector/core/modules/media/index.ts";
import { HttpError } from "../http/index.ts";
import { providerContext, resolveMediaProvider } from "./provider.ts";

const TRANSCRIBE_TIMEOUT_MS = 2 * 60 * 1000;

export interface MediaTranscription {
  text: string;
  providerId: string;
  providerName: string;
  model: string;
  contextSent: boolean;
}

/**
 * One recording read by a media model, without a job or a saved artifact: the caller keeps the
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
  return {
    text,
    providerId: provider.id,
    providerName: provider.name,
    model: input.model,
    contextSent: Boolean(input.prompt?.trim() && adapter.transcriptionPrompt),
  };
}
