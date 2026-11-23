import type {
  MediaCapability,
  MediaModelDetails,
  MediaModelOptions,
} from "@ai-projector/core/modules/media/index.ts";
import type { MediaAdapterModel } from "../media/index.ts";

const IMAGE_SIZES = ["1024*1024", "1280*720", "720*1280", "2048*2048"];
const VIDEO_RESOLUTIONS = ["480P", "720P", "1080P"];
const VIDEO_RATIOS = ["16:9", "9:16", "1:1"];

const PRICE_SOURCE = "https://www.alibabacloud.com/help/en/model-studio/model-pricing";
const DOCS = "https://www.alibabacloud.com/help/en/model-studio/models";
const CHECKED_AT = "2026-11-23";

function model(
  id: string,
  capability: MediaCapability,
  title: string,
  details: MediaModelDetails,
  options?: MediaModelOptions,
): MediaAdapterModel {
  return {
    id,
    capability,
    title,
    ...details,
    ...(details.prices ? { priceSource: PRICE_SOURCE, priceCheckedAt: CHECKED_AT } : {}),
    docs: details.docs ?? DOCS,
    ...(options ? { options } : {}),
  };
}

/**
 * Проверенный каталог QwenCloud. Модели и их параметры меняются чаще текстовых, поэтому список
 * явный и локальный: провайдерский `/models` медиа-модели обычно не перечисляет. Цены — тариф
 * International (Singapore) без акций, сняты 23.11.2026; регион ключа может менять цифры.
 */
export function qwencloudModels(): MediaAdapterModel[] {
  return [
    model(
      "qwen-image-3.0-pro",
      "image.generate",
      "Qwen Image 3.0 Pro",
      {
        description:
          "Флагман генерации изображений: сложные сцены, мелкий текст и детали. 1K и 2K, цена за изображение.",
        input: ["text"],
        output: ["image"],
        prices: [
          { amount: 0.04, currency: "USD", unit: "image", variant: "1K" },
          { amount: 0.0688, currency: "USD", unit: "image", variant: "2K" },
        ],
      },
      { sizes: IMAGE_SIZES, defaults: { size: "1024*1024", n: 1 } },
    ),
    model(
      "qwen-image-3.0",
      "image.generate",
      "Qwen Image 3.0",
      {
        description: "Быстрая генерация изображений с хорошим качеством и меньшей ценой, чем Pro.",
        input: ["text"],
        output: ["image"],
        prices: [{ amount: 0.03, currency: "USD", unit: "image", variant: "1K" }],
      },
      { sizes: IMAGE_SIZES, defaults: { size: "1024*1024", n: 1 } },
    ),
    model(
      "qwen-image-2.1-pro",
      "image.generate",
      "Qwen Image 2.1 Pro",
      {
        description: "Предыдущее поколение Pro: композиция и надписи, одно изображение за запрос.",
        input: ["text"],
        output: ["image"],
        prices: [{ amount: 0.04, currency: "USD", unit: "image" }],
      },
      { sizes: IMAGE_SIZES, defaults: { size: "1024*1024", n: 1 } },
    ),
    model(
      "qwen-image-2.1-turbo",
      "image.generate",
      "Qwen Image 2.1 Turbo",
      {
        description: "Самая быстрая и дешёвая модель линейки 2.x: черновики и массовые картинки.",
        input: ["text"],
        output: ["image"],
        prices: [{ amount: 0.016, currency: "USD", unit: "image" }],
      },
      { sizes: IMAGE_SIZES, defaults: { size: "1024*1024", n: 1 } },
    ),
    model(
      "qwen-image-2.0",
      "image.generate",
      "Qwen Image 2.0",
      {
        description:
          "Базовая генерация изображений 2.x; держите её, если промпты настроены под неё.",
        input: ["text"],
        output: ["image"],
        prices: [{ amount: 0.035, currency: "USD", unit: "image" }],
      },
      { sizes: IMAGE_SIZES, defaults: { size: "1024*1024", n: 1 } },
    ),
    model(
      "qwen3-tts-flash",
      "speech.synthesize",
      "Qwen3 TTS Flash",
      {
        description:
          "Быстрый синтез речи с голосом Cherry; тариф по символам, вывод не тарифицируется отдельно.",
        input: ["text"],
        output: ["audio"],
        prices: [{ amount: 0.11, currency: "USD", unit: "10k-characters" }],
      },
      {
        voices: ["Cherry"],
        formats: ["mp3", "wav"],
        defaults: { voice: "Cherry" },
      },
    ),
    model(
      "qwen-audio-3.1-asr-flash",
      "speech.transcribe",
      "Qwen Audio 3.1 ASR Flash",
      {
        description:
          "Распознавание записанной речи; тариф по токенам входа и выхода, поэтому короткая запись стоит копейки.",
        input: ["audio"],
        output: ["text"],
        prices: [
          { amount: 0.15, currency: "USD", unit: "1m-tokens", appliesTo: "input" },
          { amount: 0.47, currency: "USD", unit: "1m-tokens", appliesTo: "output" },
        ],
      },
      { formats: ["wav", "mp3", "m4a"] },
    ),
    model(
      "wan3.0-video",
      "video.generate",
      "Wan 3.0",
      {
        description:
          "Видео из текста с озвучкой: 480P, 720P и 1080P. Цена за секунду; акции провайдера здесь не учтены.",
        input: ["text"],
        output: ["video"],
        prices: [
          { amount: 0.05, currency: "USD", unit: "second", variant: "480P" },
          { amount: 0.1, currency: "USD", unit: "second", variant: "720P" },
          { amount: 0.2, currency: "USD", unit: "second", variant: "1080P" },
        ],
      },
      {
        resolutions: VIDEO_RESOLUTIONS,
        ratios: VIDEO_RATIOS,
        durations: [5, 10],
        defaults: { resolution: "720P", ratio: "16:9", duration: 5 },
      },
    ),
    model(
      "wan2.6-t2v",
      "video.generate",
      "Wan 2.6 Text to Video",
      {
        description: "Видео из текста: 720P и 1080P, длительность до 15 секунд.",
        input: ["text"],
        output: ["video"],
        prices: [
          { amount: 0.1, currency: "USD", unit: "second", variant: "720P" },
          { amount: 0.15, currency: "USD", unit: "second", variant: "1080P" },
        ],
      },
      {
        sizes: ["1280*720", "720*1280", "1920*1080"],
        durations: [5, 10, 15],
        defaults: { size: "1280*720", duration: 5 },
      },
    ),
    model(
      "wan2.6-i2v",
      "video.generate",
      "Wan 2.6 Image to Video",
      {
        description: "Видео из изображения: 720P и 1080P, оживляет кадр по описанию движения.",
        input: ["text", "image"],
        output: ["video"],
        prices: [
          { amount: 0.1, currency: "USD", unit: "second", variant: "720P" },
          { amount: 0.15, currency: "USD", unit: "second", variant: "1080P" },
        ],
      },
      {
        sizes: ["1280*720", "720*1280", "1920*1080"],
        durations: [5, 10],
        defaults: { size: "1280*720", duration: 5 },
      },
    ),
  ];
}
