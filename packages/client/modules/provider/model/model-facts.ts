import {
  providerModelKindOf,
  formatContextWindow,
  formatProviderModelPrice,
  providerModelModalityTitle,
} from "@ai-projector/core/modules/providers/index.ts";
import type {
  ModelPrice,
  ProviderModelCapability,
  ProviderModelInfo,
  ProviderModelKind,
  ProviderModelModality,
} from "./types.ts";

export interface ModelRow {
  id: string;
  alias: string;
  contextTokens?: number;
  price?: ModelPrice;
  thinking?: boolean;
  on: boolean;
  /** What the provider catalog says about this id; absent for unknown custom models. */
  info?: ProviderModelInfo;
  /** The same in the shape the list renders: kind, modalities, window, tariff, abilities. */
  facts?: ModelFacts;
}

/** Pictograms for the facts line; the text lives in the tooltip and the accessible name. */
const CAPABILITY_ICONS: Record<ProviderModelCapability, string> = {
  tools: "wrench",
  reasoning: "brain",
  json: "braces",
  vision: "eye",
  "audio-input": "audio-lines",
  "video-input": "video",
};
const MODALITY_ICONS: Record<ProviderModelModality, string> = {
  text: "type",
  image: "image",
  audio: "audio-lines",
  video: "video",
  vector: "binary",
};
const KIND_ICONS: Record<ProviderModelKind, string> = {
  chat: "message-square",
  image: "image",
  speech: "volume-2",
  transcription: "mic",
  video: "video",
  embedding: "boxes",
  rerank: "list-ordered",
  other: "circle-help",
};
export const capabilityIcon = (item: ProviderModelCapability) => CAPABILITY_ICONS[item];
export const CAPABILITY_LEGEND = Object.keys(CAPABILITY_ICONS) as ProviderModelCapability[];
export const modalityIcon = (item: ProviderModelModality) => MODALITY_ICONS[item];
export const kindIcon = (item: ProviderModelKind) => KIND_ICONS[item];

interface ModelFacts {
  kind: ProviderModelKind;
  input: ProviderModelModality[];
  output: ProviderModelModality[];
  context?: string;
  price?: string;
  priceNote?: string;
  capabilities: ProviderModelCapability[];
}

/** Everything the list shows about a model, ready for pictograms and one compact line. */
export function modelFacts(info: ProviderModelInfo | undefined): ModelFacts | undefined {
  if (!info) return undefined;
  return {
    kind: providerModelKindOf(info),
    input: info.input ?? [],
    output: info.output ?? [],
    ...(info.contextTokens ? { context: formatContextWindow(info.contextTokens) } : {}),
    ...(info.price
      ? { price: formatProviderModelPrice(info.price, info.currency) }
      : info.priceNote
        ? { priceNote: info.priceNote }
        : {}),
    capabilities: info.capabilities ?? [],
  };
}

/** A tooltip for the input and output of a model: «вход: текст + изображение». */
export function modalityTitle(side: "вход" | "выход", item: ProviderModelModality): string {
  return `${side}: ${providerModelModalityTitle(item)}`;
}

/** Chat models first: media and embeddings are visible but do not drown the list. */
const KIND_ORDER = {
  chat: 0,
  image: 1,
  transcription: 2,
  speech: 3,
  video: 4,
  embedding: 5,
  rerank: 6,
  other: 7,
} as const;
export function kindRank(info: ProviderModelInfo | undefined): number {
  return info ? KIND_ORDER[providerModelKindOf(info)] : KIND_ORDER.other;
}
