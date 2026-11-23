import type {
  ProviderModelCapability,
  ProviderModelKind,
  ProviderModelModality,
  ProviderModelPrice,
} from "@ai-projector/core/modules/providers/index.ts";
import type { ProviderKind } from "./types.ts";

const ALIBABA_SOURCE = "https://www.alibabacloud.com/help/en/model-studio/model-pricing";
const DEEPSEEK_SOURCE = "https://api-docs.deepseek.com/quick_start/pricing";
export const CHECKED_AT = "2026-11-23";

export interface LocalEntry {
  kind?: ProviderModelKind;
  contextTokens?: number;
  maxOutputTokens?: number;
  price?: ProviderModelPrice;
  priceNote?: string;
  currency?: string;
  capabilities?: ProviderModelCapability[];
  input?: ProviderModelModality[];
  output?: ProviderModelModality[];
  source?: string;
  deprecated?: boolean;
}

/**
 * QwenCloud model prices in the International (Singapore) scope, original rates without
 * promotions. Dated snapshots inherit the family entry; tiered models carry only a note, because
 * one static tariff would make cost accounting wrong outside the first tier.
 */
const QWEN: Record<string, LocalEntry> = {
  "qwen4-max": {
    contextTokens: 1_000_000,
    price: { input: 1.5, output: 4.5, cacheRead: 0.15 },
    capabilities: ["tools", "reasoning", "vision", "video-input"],
    input: ["text", "image", "video"],
  },
  "qwen3.8-max": {
    contextTokens: 1_000_000,
    price: { input: 2, output: 6 },
    capabilities: ["tools", "reasoning", "vision", "video-input"],
    input: ["text", "image", "video"],
  },
  "qwen3.7-max": {
    contextTokens: 1_000_000,
    price: { input: 2.5, output: 7.5 },
    capabilities: ["tools", "reasoning", "vision"],
    input: ["text", "image"],
  },
  "qwen-max": { contextTokens: 32_768, price: { input: 1.6, output: 6.4 }, deprecated: true },
  "qwen3.7-plus": {
    contextTokens: 1_000_000,
    priceNote: "до 256K — $0,4/$1,6, до 1M — $1,2/$4,8 за 1 млн токенов",
    capabilities: ["tools", "reasoning", "vision"],
    input: ["text", "image"],
  },
  "qwen3.6-plus": { contextTokens: 1_000_000, price: { input: 0.5, output: 3 } },
  "qwen3.5-plus": {
    contextTokens: 1_000_000,
    priceNote: "до 256K — $0,4/$2,4, до 1M — $0,5/$3 за 1 млн токенов",
  },
  "qwen-plus": {
    contextTokens: 1_000_000,
    priceNote: "до 256K — $0,4/$1,2, до 1M — $1,2/$3,6 за 1 млн токенов",
  },
  "qwen3.8-flash": { contextTokens: 1_000_000, price: { input: 0.15, output: 0.47 } },
  "qwen3.7-flash": {
    contextTokens: 1_000_000,
    priceNote: "до 32K — $0,03/$0,13, до 256K — $0,1/$0,4, до 1M — $0,2/$0,8",
  },
  "qwen3.6-flash": {
    contextTokens: 1_000_000,
    priceNote: "до 256K — $0,25/$1,5, до 1M — $1/$4",
  },
  "qwen3.5-flash": { contextTokens: 1_000_000, price: { input: 0.1, output: 0.4 } },
  "qwen-flash": {
    contextTokens: 1_000_000,
    priceNote: "до 256K — $0,05/$0,4, до 1M — $0,25/$2",
  },
  "qwen3.5-omni-plus": {
    price: { input: 1.4, output: 8.3 },
    priceNote: "звук на входе — $11, звук на выходе — $44 за 1 млн токенов",
    capabilities: ["tools", "reasoning", "vision", "audio-input"],
    input: ["text", "image", "audio"],
  },
  "qwen3.5-omni-flash": {
    price: { input: 0.4, output: 2.2 },
    priceNote: "звук на входе — $3, звук на выходе — $11,9 за 1 млн токенов",
    capabilities: ["tools", "reasoning", "vision", "audio-input"],
    input: ["text", "image", "audio"],
  },
  "qwen3-omni-flash": {
    price: { input: 0.43, output: 3.06 },
    capabilities: ["tools", "reasoning", "vision", "audio-input"],
    input: ["text", "image", "audio"],
  },
  "qwen3-vl-plus": {
    contextTokens: 256_000,
    priceNote: "до 32K — $0,2/$1,6, до 128K — $0,3/$2,4, до 256K — $0,6/$4,8",
    capabilities: ["tools", "reasoning", "vision"],
    input: ["text", "image"],
  },
  "qwen-vl-ocr": {
    contextTokens: 256_000,
    price: { input: 0.07, output: 0.16 },
    capabilities: ["vision"],
    input: ["text", "image"],
  },
  "qwen3-coder-flash": {
    contextTokens: 1_000_000,
    priceNote: "до 32K — $0,3/$1,5, до 256K — $0,8/$4, до 1M — $1,6/$9,6",
    capabilities: ["tools", "reasoning"],
  },
  "qwen-mt-plus": { price: { input: 2.46, output: 7.37 } },
  "qwen-mt-flash": { price: { input: 0.16, output: 0.49 } },
  "qwen-mt-lite": { price: { input: 0.12, output: 0.36 } },
  "qwen-doc-turbo": { price: { input: 0.087, output: 0.144 } },
  "qwen-deep-research": { price: { input: 7.742, output: 23.367 } },
  "qwen3.8-2.4t-a95b": { contextTokens: 1_000_000, price: { input: 2, output: 6 } },
  "qwen3.8-27b": { contextTokens: 1_000_000, price: { input: 0.5, output: 3 } },
  "glm-5.3": { price: { input: 1.4, output: 4.4 }, capabilities: ["tools", "reasoning"] },
  "glm-5.2": { price: { input: 1.4, output: 4.4 }, capabilities: ["tools", "reasoning"] },
  "glm-5.2-fast-preview": { price: { input: 2.8, output: 8.8 } },
  "glm-5.3-prime": { price: { input: 2.8, output: 8.8 } },
  "glm-5.1": { price: { input: 1.4, output: 4.4 } },
  "kimi-k3": { price: { input: 2.827, output: 14.133 }, capabilities: ["tools", "reasoning"] },
  "kimi-k3.1-pro": { price: { input: 1.837, output: 9.611 } },
  "kimi-k2.7-code": { price: { input: 0.894, output: 3.713 } },
  "kimi-k2.6": { price: { input: 0.8939, output: 3.7131 } },
  "kimi-k2.5": { price: { input: 0.574, output: 3.011 } },
  "deepseek-v4.1-flash": {
    contextTokens: 1_000_000,
    price: { input: 0.3, output: 1.2 },
    priceNote: "в непиковые часы вдвое дешевле: $0,15/$0,6",
    capabilities: ["tools", "reasoning"],
  },
  "deepseek-v4-pro": {
    contextTokens: 1_000_000,
    price: { input: 2.4, output: 4.8 },
    capabilities: ["tools", "reasoning"],
  },
  "deepseek-v4-pro-0813": {
    contextTokens: 1_000_000,
    price: { input: 1.32, output: 3.96 },
    priceNote: "в непиковые часы вдвое дешевле: $0,66/$1,98",
  },
  "deepseek-v4-flash-0731": {
    contextTokens: 1_000_000,
    price: { input: 0.44, output: 1.32 },
    priceNote: "в непиковые часы вдвое дешевле: $0,22/$0,66",
  },
  "mindlab/macaron-v1-tall": { price: { input: 0.45, output: 2.6 } },
  "mindlab/macaron-v1.1-venti": { price: { input: 1.19, output: 3.74 } },
  "mindlab/macaron-v1.1-coding-venti": { price: { input: 1.19, output: 3.74 } },
  "mindlab/macaron-v1.1-venti-pro": { price: { input: 2, output: 10 } },
};

/** DeepSeek's own API: peak rates, off-peak is half of them. */
const DEEPSEEK: Record<string, LocalEntry> = {
  "deepseek-flash": {
    contextTokens: 1_000_000,
    maxOutputTokens: 384_000,
    price: { input: 0.3, output: 1.2, cacheRead: 0.006 },
    priceNote: "в непиковые часы вдвое дешевле; попадание в кэш — $0,006 за 1 млн",
    capabilities: ["tools", "reasoning", "vision", "json"],
    input: ["text", "image"],
  },
  "deepseek-v4-pro": {
    contextTokens: 1_000_000,
    maxOutputTokens: 384_000,
    price: { input: 1.32, output: 3.96, cacheRead: 0.044 },
    priceNote: "в непиковые часы вдвое дешевле; попадание в кэш — $0,044 за 1 млн",
    capabilities: ["tools", "reasoning", "json"],
  },
};

/**
 * Media and other non-chat models that show up in provider `/models` lists. They cannot be
 * registered as chat models, but they must not look like chat either: the list says what goes in
 * and what comes out, and the tariff is per image, second, minute or 10k characters.
 */
const OPENAI_SOURCE = "https://platform.openai.com/docs/pricing";

function imageModel(
  rate: string,
  source = OPENAI_SOURCE,
  input: ProviderModelModality[] = ["text"],
): LocalEntry {
  return {
    kind: "image",
    input,
    output: ["image"],
    priceNote: rate,
    source,
    capabilities: input.includes("image") ? ["vision"] : undefined,
  };
}

function speechModel(rate: string, source: string): LocalEntry {
  return { kind: "speech", input: ["text"], output: ["audio"], priceNote: rate, source };
}

function transcriptionModel(rate: string, source = OPENAI_SOURCE): LocalEntry {
  return { kind: "transcription", input: ["audio"], output: ["text"], priceNote: rate, source };
}

const MEDIA: Record<string, LocalEntry> = {
  "qwen-image-3.0-pro": imageModel("1K — $0,04, 2K — $0,0688 за изображение", ALIBABA_SOURCE),
  "qwen-image-3.0": imageModel("$0,03 за изображение (1K)", ALIBABA_SOURCE),
  "qwen-image-2.1-pro": imageModel("$0,04 за изображение", ALIBABA_SOURCE),
  "qwen-image-2.1-turbo": imageModel("$0,016 за изображение", ALIBABA_SOURCE),
  "qwen-image-2.0": imageModel("$0,035 за изображение", ALIBABA_SOURCE),
  "qwen-image-2.0-pro": imageModel("$0,075 за изображение", ALIBABA_SOURCE),
  "wan3.0-video": {
    kind: "video",
    input: ["text"],
    output: ["video"],
    priceNote: "480P — $0,05, 720P — $0,1, 1080P — $0,2 за секунду",
    source: ALIBABA_SOURCE,
  },
  "wan2.6-t2v": {
    kind: "video",
    input: ["text"],
    output: ["video"],
    priceNote: "720P — $0,1, 1080P — $0,15 за секунду",
    source: ALIBABA_SOURCE,
  },
  "wan2.6-i2v": {
    kind: "video",
    input: ["text", "image"],
    output: ["video"],
    priceNote: "720P — $0,1, 1080P — $0,15 за секунду",
    source: ALIBABA_SOURCE,
    capabilities: ["vision"],
  },
  "qwen3-tts-flash": speechModel("$0,11 за 10 тыс. символов", ALIBABA_SOURCE),
  "qwen-audio-3.1-asr-flash": transcriptionModel(
    "вход $0,15, выход $0,47 за 1 млн токенов",
    ALIBABA_SOURCE,
  ),
  "qwen-audio-3.1-realtime-plus": {
    kind: "speech",
    input: ["text", "audio"],
    output: ["text", "audio"],
    priceNote: "текст $0,8 / $6,4, звук $6,4 / $24 за 1 млн токенов",
    source: ALIBABA_SOURCE,
    capabilities: ["audio-input"],
  },
  "qwen-audio-3.1-realtime-flash": {
    kind: "speech",
    input: ["text", "audio"],
    output: ["text", "audio"],
    priceNote: "текст $0,23 / $0,7, звук $0,93 / $1,87 за 1 млн токенов",
    source: ALIBABA_SOURCE,
    capabilities: ["audio-input"],
  },
  "whisper-1": transcriptionModel("$0,006 за минуту"),
  "gpt-4o-mini-transcribe": transcriptionModel("$0,003 за минуту (оценка провайдера)"),
  "gpt-4o-transcribe": transcriptionModel("$0,006 за минуту"),
  "gpt-transcribe": transcriptionModel("$0,0045 за минуту"),
  "tts-1": speechModel("$15 за 1 млн символов", OPENAI_SOURCE),
  "gpt-4o-mini-tts": speechModel("$12 за 1 млн аудиотокенов на выходе", OPENAI_SOURCE),
  "gpt-image-1": imageModel("цена не опубликована на странице тарифа", OPENAI_SOURCE, [
    "text",
    "image",
  ]),
  "dall-e-3": imageModel("цена не опубликована на странице тарифа"),
};

/** Media models that the provider lists by family with dates or size suffixes. */
export function mediaEntry(id: string): LocalEntry | undefined {
  const base = baseId(id.toLowerCase());
  const exact = MEDIA[base];
  if (exact) return exact;
  if (/^wan\d+(\.\d+)?-(t2v|i2v|video)/.test(base) || base.includes("-video"))
    return {
      kind: "video",
      input: base.includes("i2v") || base.includes("image") ? ["text", "image"] : ["text"],
      output: ["video"],
      priceNote: "цена за секунду по разрешению — на странице тарифа провайдера",
      source: ALIBABA_SOURCE,
    };
  if (base.includes("asr") || base.includes("transcri"))
    return transcriptionModel("цена за минуту или токены — на странице тарифа", ALIBABA_SOURCE);
  if (base.includes("tts") || base.includes("cosyvoice"))
    return speechModel("цена за 10 тыс. символов — на странице тарифа", ALIBABA_SOURCE);
  if (base.includes("image") || base.includes("dall-e"))
    return imageModel("цена за изображение — на странице тарифа провайдера");
  if (base.includes("embedding")) return { kind: "embedding", input: ["text"], output: ["vector"] };
  if (base.includes("rerank")) return { kind: "rerank", input: ["text"], output: ["vector"] };
  return undefined;
}

/** The model id without its dated snapshot: `qwen3.7-plus-2026-05-26` → `qwen3.7-plus`. */
export function baseId(id: string): string {
  return id.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-latest$/, "");
}

export function localEntry(kind: ProviderKind | undefined, id: string): LocalEntry | undefined {
  if (kind === "qwencloud") return QWEN[id] ?? QWEN[baseId(id)];
  if (kind === "deepseek") return DEEPSEEK[id] ?? DEEPSEEK[baseId(id)];
  return undefined;
}

export function localSource(kind: ProviderKind | undefined): string | undefined {
  if (kind === "qwencloud") return ALIBABA_SOURCE;
  if (kind === "deepseek") return DEEPSEEK_SOURCE;
  return undefined;
}
