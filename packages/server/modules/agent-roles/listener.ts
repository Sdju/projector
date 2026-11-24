import {
  MEDIA_ROLE_CONTEXT_LIMIT,
  mediaModelSelection,
  type ServiceRoleId,
} from "@ai-projector/core/modules/agent-role/index.ts";
import { HttpError } from "../http/index.ts";
import {
  listMediaModels,
  mediaProviders,
  transcribeMedia,
  type MediaTranscription,
} from "../media/index.ts";
import { serviceRolePrompt, serviceRoleSelection } from "./store.ts";
import { recordMediaSpend } from "../spend/index.ts";

/** The built-in role that turns a recording into text. */
const LISTENER: ServiceRoleId = "listener";

/** Where Listener would send a recording now: the chosen media model or the first available one. */
export interface ListenerTarget {
  providerId: string;
  providerName: string;
  model: string;
  capability: "speech.transcribe";
  /** No model was chosen in the settings: the first available recognition model is used. */
  auto: boolean;
}

export interface ListenerState extends Partial<ListenerTarget> {
  configured: boolean;
  /** The context the role sends with every recording, when it has one. */
  context: string;
}

/**
 * The recognition model of Listener. A chosen model wins even when it is no longer listed: the
 * provider may know it after the catalog changed. Without a choice, the first model whose
 * adapter reports `speech.transcribe` is used, which keeps the role working before setup.
 */
export async function listenerTarget(): Promise<ListenerTarget | undefined> {
  const chosen = mediaModelSelection(await serviceRoleSelection(LISTENER));
  if (chosen) {
    const state = await mediaProviders().catch(() => undefined);
    const provider = state?.providers.find((item) => item.id === chosen.providerId);
    return {
      providerId: chosen.providerId,
      providerName: provider?.name ?? chosen.providerId,
      model: chosen.model,
      capability: "speech.transcribe",
      auto: false,
    };
  }
  const first = (await listMediaModels("speech.transcribe"))[0];
  if (!first) return undefined;
  return {
    providerId: first.providerId,
    providerName: first.providerName,
    model: first.id,
    capability: "speech.transcribe",
    auto: true,
  };
}

/** What the settings and the composer need to show about Listener without sending audio. */
export async function listenerState(): Promise<ListenerState> {
  const [target, prompt] = await Promise.all([listenerTarget(), serviceRolePrompt(LISTENER)]);
  return {
    configured: target !== undefined,
    ...target,
    context: prompt ?? "",
  };
}

export interface ListenerTranscription extends MediaTranscription {
  /** Whether the role's context reached the model; not every adapter accepts hints. */
  contextSent: boolean;
}

/**
 * Reads one recording as Listener: the role's own context and the caller's hints go as one prompt.
 * Audio is passed through and dropped by the caller; nothing is saved as a media artifact.
 */
export async function listenerTranscribe(input: {
  audio: { base64: string; mime: string };
  language?: string | undefined;
  hints?: string | undefined;
}): Promise<ListenerTranscription> {
  const target = await listenerTarget();
  if (!target) throw new HttpError(409, "Listener не настроен: нет модели распознавания речи");
  const prompt = [(await serviceRolePrompt(LISTENER)) ?? "", input.hints ?? ""]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MEDIA_ROLE_CONTEXT_LIMIT);
  const result = await transcribeMedia({
    providerId: target.providerId,
    model: target.model,
    audio: input.audio,
    ...(input.language ? { language: input.language } : {}),
    ...(prompt ? { prompt } : {}),
  });
  recordMediaSpend("dictation", result, {
    provider: result.providerId,
    model: result.model,
  });
  return result;
}
