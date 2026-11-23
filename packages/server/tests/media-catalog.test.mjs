import { expect, test } from "vite-plus/test";
import { openAiMediaAdapter } from "../modules/media-openai/index.ts";
import { qwencloudAdapter } from "../modules/media-qwencloud/index.ts";

const UNITS = new Set([
  "image",
  "second",
  "minute",
  "10k-characters",
  "1m-characters",
  "1m-tokens",
  "request",
]);

const MODALITIES = new Set(["text", "image", "audio", "video"]);

function catalogOf(adapter) {
  return adapter.listModels({});
}

function checkCatalog(label, models) {
  expect(models.length, `${label}: models`).toBeGreaterThan(0);
  for (const model of models) {
    expect(model.description, `${label}/${model.id}: description`).toBeTruthy();
    expect(model.input?.length, `${label}/${model.id}: input`).toBeGreaterThan(0);
    expect(model.output?.length, `${label}/${model.id}: output`).toBeGreaterThan(0);
    for (const modality of [...(model.input ?? []), ...(model.output ?? [])])
      expect(MODALITIES.has(modality), `${label}/${model.id}: modality ${modality}`).toBe(true);
    for (const price of model.prices ?? []) {
      expect(price.amount, `${label}/${model.id}: amount`).toBeGreaterThan(0);
      expect(UNITS.has(price.unit), `${label}/${model.id}: unit ${price.unit}`).toBe(true);
      expect(typeof price.currency).toBe("string");
    }
    if (model.prices?.length) {
      expect(model.priceSource, `${label}/${model.id}: source`).toMatch(/^https:\/\//);
      expect(model.priceCheckedAt, `${label}/${model.id}: date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  }
}

test("both built-in catalogs describe what each model does and costs", () => {
  checkCatalog("openai", catalogOf(openAiMediaAdapter));
  checkCatalog("qwencloud", catalogOf(qwencloudAdapter));
});

test("speech models carry the rates used by Listener and dictation", () => {
  expect(openAiMediaAdapter.transcriptionPrompt).toBe(true);
  expect(qwencloudAdapter.transcriptionPrompt).not.toBe(true);
  const openai = catalogOf(openAiMediaAdapter);
  const whisper = openai.find((model) => model.id === "whisper-1");
  expect(whisper.prices).toEqual([{ amount: 0.006, currency: "USD", unit: "minute" }]);
  expect(whisper.languages).toContain("multi");

  const mini = openai.find((model) => model.id === "gpt-4o-mini-transcribe");
  expect(mini.prices[0]).toMatchObject({ amount: 0.003, unit: "minute", estimated: true });

  const qwen = catalogOf(qwencloudAdapter);
  const asr = qwen.find((model) => model.id === "qwen-audio-3.1-asr-flash");
  expect(asr.prices).toEqual([
    { amount: 0.15, currency: "USD", unit: "1m-tokens", appliesTo: "input" },
    { amount: 0.47, currency: "USD", unit: "1m-tokens", appliesTo: "output" },
  ]);
});

test("tiered prices stay separate lines instead of one vague number", () => {
  const qwen = catalogOf(qwencloudAdapter);
  const image = qwen.find((model) => model.id === "qwen-image-3.0-pro");
  expect(image.prices.map((price) => price.variant)).toEqual(["1K", "2K"]);
  const video = qwen.find((model) => model.id === "wan3.0-video");
  expect(video.prices.map((price) => [price.variant, price.amount])).toEqual([
    ["480P", 0.05],
    ["720P", 0.1],
    ["1080P", 0.2],
  ]);
  expect(video.prices.every((price) => price.unit === "second")).toBe(true);
});
