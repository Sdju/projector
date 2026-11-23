import { afterEach, expect, test } from "vite-plus/test";
import { providerModelCatalog } from "../modules/providers/index.ts";

const originalFetch = globalThis.fetch;

function stubOpenRouter(data) {
  globalThis.projectorOpenRouterCatalog = undefined;
  globalThis.fetch = async (url) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (href.includes("openrouter.ai/api/v1/models"))
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    return new Response("{}", { status: 404 });
  };
}

const openRouterModel = (id, extra = {}) => ({
  id,
  name: id,
  description: `Описание ${id}`,
  context_length: 1_000_000,
  architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
  supported_parameters: ["tools", "reasoning"],
  pricing: { prompt: "0.001", completion: "0.002" },
  top_provider: { max_completion_tokens: 64_000 },
  ...extra,
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.projectorOpenRouterCatalog = undefined;
});

test("known QwenCloud models take prices from the provider tariff, not OpenRouter", async () => {
  stubOpenRouter([
    openRouterModel("qwen/qwen3.7-flash"),
    openRouterModel("deepseek/deepseek-v4-pro"),
  ]);
  const catalog = await providerModelCatalog({
    kind: "qwencloud",
    ids: ["qwen3.7-flash", "deepseek-v4-pro", "mystery-model"],
  });
  expect(catalog["mystery-model"]).toBeUndefined();

  const qwen = catalog["qwen3.7-flash"];
  expect(qwen).toMatchObject({
    contextTokens: 1_000_000,
    source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
    checkedAt: "2026-11-23",
  });
  expect(qwen.price).toBeUndefined();
  expect(qwen.priceNote).toContain("до 32K");
  expect(qwen.description).toContain("qwen/qwen3.7-flash");
  expect(qwen.capabilities).toEqual(expect.arrayContaining(["tools", "reasoning", "vision"]));

  const deepseek = catalog["deepseek-v4-pro"];
  expect(deepseek.price).toEqual({ input: 2.4, output: 4.8 });
  expect(deepseek.contextTokens).toBe(1_000_000);
});

test("multimodal audio understanding remains a chat model", async () => {
  stubOpenRouter([
    openRouterModel("google/gemini-test", {
      architecture: {
        input_modalities: ["text", "audio", "image"],
        output_modalities: ["text"],
      },
    }),
  ]);
  const catalog = await providerModelCatalog({
    kind: "openrouter",
    ids: ["google/gemini-test"],
  });
  expect(catalog["google/gemini-test"].kind).toBe("chat");
});

test("an OpenRouter provider keeps OpenRouter prices and gets modalities", async () => {
  stubOpenRouter([
    openRouterModel("qwen/qwen3.7-flash", {
      pricing: { prompt: "0.0000004", completion: "0.0000016" },
    }),
  ]);
  const catalog = await providerModelCatalog({ kind: "openrouter", ids: ["qwen/qwen3.7-flash"] });
  expect(catalog["qwen/qwen3.7-flash"]).toMatchObject({
    price: { input: 0.4, output: 1.6 },
    input: ["text", "image"],
    output: ["text"],
    contextTokens: 1_000_000,
    source: "https://openrouter.ai/models",
  });
});

test("a direct DeepSeek provider gets its own window, output limit and rates", async () => {
  stubOpenRouter([]);
  const catalog = await providerModelCatalog({ kind: "deepseek", ids: ["deepseek-flash"] });
  expect(catalog["deepseek-flash"]).toMatchObject({
    contextTokens: 1_000_000,
    maxOutputTokens: 384_000,
    price: { input: 0.3, output: 1.2, cacheRead: 0.006 },
    source: "https://api-docs.deepseek.com/quick_start/pricing",
  });
  expect(catalog["deepseek-flash"].capabilities).toContain("vision");
});

test("without OpenRouter the local tariff still describes the model", async () => {
  globalThis.projectorOpenRouterCatalog = undefined;
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  const catalog = await providerModelCatalog({ kind: "qwencloud", ids: ["qwen3.8-flash"] });
  expect(catalog["qwen3.8-flash"]).toMatchObject({
    contextTokens: 1_000_000,
    price: { input: 0.15, output: 0.47 },
    source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
  });
});

test("media and multimodal ids are described by what they take and return", async () => {
  stubOpenRouter([]);
  const catalog = await providerModelCatalog({
    kind: "qwencloud",
    ids: [
      "qwen-image-3.0-pro",
      "wan2.7-image",
      "qwen-audio-3.0-asr-flash",
      "qwen3-tts-flash",
      "qwen3.8-flash",
      "text-embedding-v4",
    ],
  });
  expect(catalog["qwen-image-3.0-pro"]).toMatchObject({
    kind: "image",
    input: ["text"],
    output: ["image"],
    priceNote: "1K — $0,04, 2K — $0,0688 за изображение",
  });
  expect(catalog["wan2.7-image"].kind).toBe("image");
  expect(catalog["qwen-audio-3.0-asr-flash"]).toMatchObject({
    kind: "transcription",
    input: ["audio"],
    output: ["text"],
  });
  expect(catalog["qwen3-tts-flash"]).toMatchObject({
    kind: "speech",
    input: ["text"],
    output: ["audio"],
  });
  expect(catalog["qwen3.8-flash"].kind).toBe("chat");
  expect(catalog["qwen3.8-flash"].output).toEqual(["text"]);
  expect(catalog["text-embedding-v4"]).toMatchObject({
    kind: "embedding",
    input: ["text"],
    output: ["vector"],
  });
  // Media entries never carry a per-token price that could be mistaken for chat cost.
  expect(catalog["qwen-image-3.0-pro"].price).toBeUndefined();
});

test("OpenAI-style media ids are recognised on a custom provider", async () => {
  stubOpenRouter([]);
  const catalog = await providerModelCatalog({
    kind: "custom",
    ids: ["whisper-1", "tts-1", "gpt-image-1", "text-embedding-3-small"],
  });
  expect(catalog["whisper-1"]).toMatchObject({
    kind: "transcription",
    input: ["audio"],
    output: ["text"],
  });
  expect(catalog["tts-1"]).toMatchObject({
    kind: "speech",
    input: ["text"],
    output: ["audio"],
  });
  expect(catalog["gpt-image-1"]).toMatchObject({
    kind: "image",
    output: ["image"],
  });
  expect(catalog["text-embedding-3-small"].kind).toBe("embedding");
  expect(catalog["whisper-1"].priceNote).toContain("$0,006");
});
