import type { MediaCapability, MediaModelOptions } from "@ai-projector/core/modules/media/index.ts";
import type { MediaAdapterModel } from "../media/index.ts";

const IMAGE_SIZES = ["1024*1024", "1280*720", "720*1280", "2048*2048"];
const VIDEO_RESOLUTIONS = ["480P", "720P", "1080P"];
const VIDEO_RATIOS = ["16:9", "9:16", "1:1"];

function model(
  id: string,
  capability: MediaCapability,
  title: string,
  options?: MediaModelOptions,
): MediaAdapterModel {
  return { id, capability, title, ...(options ? { options } : {}) };
}

/**
 * Проверенный каталог QwenCloud. Модели и их параметры меняются чаще текстовых, поэтому список
 * явный и локальный: провайдерский `/models` медиа-модели обычно не перечисляет.
 */
export function qwencloudModels(): MediaAdapterModel[] {
  return [
    model("qwen-image-3.0-pro", "image.generate", "Qwen Image 3.0 Pro", {
      sizes: IMAGE_SIZES,
      defaults: { size: "1024*1024", n: 1 },
    }),
    model("qwen-image-3.0", "image.generate", "Qwen Image 3.0", {
      sizes: IMAGE_SIZES,
      defaults: { size: "1024*1024", n: 1 },
    }),
    model("qwen-image-2.1-pro", "image.generate", "Qwen Image 2.1 Pro", {
      sizes: IMAGE_SIZES,
      defaults: { size: "1024*1024", n: 1 },
    }),
    model("qwen-image-2.1-turbo", "image.generate", "Qwen Image 2.1 Turbo", {
      sizes: IMAGE_SIZES,
      defaults: { size: "1024*1024", n: 1 },
    }),
    model("qwen-image-2.0", "image.generate", "Qwen Image 2.0", {
      sizes: IMAGE_SIZES,
      defaults: { size: "1024*1024", n: 1 },
    }),
    model("qwen3-tts-flash", "speech.synthesize", "Qwen3 TTS Flash", {
      voices: ["Cherry"],
      formats: ["mp3", "wav"],
      defaults: { voice: "Cherry" },
    }),
    model("qwen-audio-3.1-asr-flash", "speech.transcribe", "Qwen Audio 3.1 ASR Flash", {
      formats: ["wav", "mp3", "m4a"],
    }),
    model("wan3.0-video", "video.generate", "Wan 3.0", {
      resolutions: VIDEO_RESOLUTIONS,
      ratios: VIDEO_RATIOS,
      durations: [5, 10],
      defaults: { resolution: "720P", ratio: "16:9", duration: 5 },
    }),
    model("wan2.6-t2v", "video.generate", "Wan 2.6 Text to Video", {
      sizes: ["1280*720", "720*1280", "1920*1080"],
      durations: [5, 10, 15],
      defaults: { size: "1280*720", duration: 5 },
    }),
    model("wan2.6-i2v", "video.generate", "Wan 2.6 Image to Video", {
      sizes: ["1280*720", "720*1280", "1920*1080"],
      durations: [5, 10],
      defaults: { size: "1280*720", duration: 5 },
    }),
  ];
}
