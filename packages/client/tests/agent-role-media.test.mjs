import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  mediaModelSelection,
  mediaModelSelectionValue,
} from "@ai-projector/core/modules/agent-role/index.ts";
import {
  listener,
  loadListener,
  loadRoleMediaModels,
  mediaModelOf,
  mediaOptionsFor,
} from "../modules/agent-roles/index.ts";

afterEach(() => vi.unstubAllGlobals());

const models = [
  {
    id: "gpt-image-1",
    alias: "gpt-image-1",
    capability: "image.generate",
    providerId: "openai",
    providerName: "OpenAI",
    adapter: "custom",
  },
  {
    id: "whisper-1",
    alias: "whisper-1",
    title: "Whisper 1",
    capability: "speech.transcribe",
    providerId: "openai",
    providerName: "OpenAI",
    adapter: "custom",
    description: "Распознавание речи и перевод на английский.",
    input: ["audio"],
    output: ["text"],
    prices: [{ amount: 0.006, currency: "USD", unit: "minute" }],
    priceSource: "https://example.com/pricing",
    priceCheckedAt: "2026-11-23",
  },
  {
    id: "qwen-audio-3.1-asr-flash",
    alias: "qwen-asr",
    capability: "speech.transcribe",
    providerId: "qwen",
    providerName: "QwenCloud",
    adapter: "qwencloud",
  },
];

function stub(modelsJson = models, listenerJson = { configured: true, context: "" }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const href = String(url);
      if (href.startsWith("/api/media/models"))
        return { ok: true, json: async () => ({ models: modelsJson }) };
      if (href === "/api/agent/listener")
        return {
          ok: true,
          json: async () => ({
            providerId: "openai",
            providerName: "OpenAI",
            model: "whisper-1",
            capability: "speech.transcribe",
            auto: false,
            ...listenerJson,
          }),
        };
      return { ok: false, json: async () => ({ error: "нет маршрута" }) };
    }),
  );
}

test("media roles see only the models of their capability", async () => {
  stub();
  await loadRoleMediaModels(true);
  const transcription = mediaOptionsFor({ media: { capability: "speech.transcribe" } });
  expect(transcription.map((option) => option.value)).toEqual([
    "openai:whisper-1",
    "qwen:qwen-audio-3.1-asr-flash",
  ]);
  expect(transcription[0]).toMatchObject({
    providerId: "openai",
    providerName: "OpenAI",
    model: "whisper-1",
    name: "Whisper 1 — OpenAI",
  });
  expect(mediaOptionsFor({ media: { capability: "video.generate" } })).toEqual([]);
  expect(mediaOptionsFor({})).toEqual([]);
});

test("the catalog carries the passport of each model", async () => {
  stub();
  await loadRoleMediaModels(true);
  expect(mediaModelOf("openai", "whisper-1")).toMatchObject({
    description: "Распознавание речи и перевод на английский.",
    input: ["audio"],
    output: ["text"],
    prices: [{ amount: 0.006, currency: "USD", unit: "minute" }],
    priceCheckedAt: "2026-11-23",
  });
  expect(mediaModelOf("openai", "missing")).toBeUndefined();
});

test("a media selection keeps the provider and the model in one value", () => {
  const value = mediaModelSelectionValue("qwen", "qwen-audio-3.1-asr-flash");
  expect(value).toBe("qwen:qwen-audio-3.1-asr-flash");
  expect(mediaModelSelection({ provider: value })).toEqual({
    providerId: "qwen",
    model: "qwen-audio-3.1-asr-flash",
  });
  expect(mediaModelSelection({ provider: "broken" })).toBeUndefined();
  expect(mediaModelSelection({})).toBeUndefined();
});

test("the listener state comes from its own route, not from the role list", async () => {
  stub(models, { configured: true, context: "Projector, TypeScript", auto: true });
  const state = await loadListener();
  expect(state).toMatchObject({
    configured: true,
    providerName: "OpenAI",
    model: "whisper-1",
    auto: true,
    context: "Projector, TypeScript",
  });
  expect(listener.value?.context).toBe("Projector, TypeScript");
});

test("a broken listener route leaves the settings usable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, json: async () => ({}) })),
  );
  expect(await loadListener()).toBeNull();
  expect(listener.value).toBeNull();
});
