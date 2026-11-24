import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { registerBuiltinMediaAdapters } from "../app/media-adapters.ts";
import { transcribeMedia } from "../modules/media/index.ts";
import { openRouterMediaAdapter } from "../modules/media-openrouter/index.ts";
import { saveProviders, useProviderVault } from "../modules/providers/index.ts";
import { createVault } from "../modules/secrets/index.ts";

registerBuiltinMediaAdapters();

const previousFetch = globalThis.fetch;

/** The address a mocked fetch was called with; Request and URL both have their own form. */
const urlOf = (url) => {
  if (typeof url === "string") return url;
  return url instanceof URL ? url.href : url.url;
};

const context = {
  id: "openrouter",
  name: "OpenRouter",
  kind: "openrouter",
  url: "https://openrouter.ai/api/v1",
  apiKey: "sk-or-test",
  signal: AbortSignal.timeout(5000),
};

const catalog = {
  data: [
    {
      id: "openai/whisper-1",
      name: "OpenAI: Whisper 1",
      description: "Whisper распознаёт речь и переводит её на английский.",
      architecture: { output_modalities: ["transcription"] },
    },
    {
      id: "openai/gpt-4o-mini-transcribe",
      name: "OpenAI: GPT-4o Mini Transcribe",
      description: "Быстрое распознавание без перевода.",
      architecture: { output_modalities: ["transcription"] },
    },
    {
      id: "openai/gpt-4o",
      name: "OpenAI: GPT-4o",
      description: "Чат-модель, не распознавание.",
      architecture: { output_modalities: ["text"] },
    },
  ],
};

beforeEach(() => {
  globalThis.projectorOpenRouterMediaCatalog = undefined;
});

afterEach(() => {
  globalThis.fetch = previousFetch;
});

describe("OpenRouter media adapter", () => {
  test("lists only speech-to-text models and caches the filtered catalog", async () => {
    const seen = [];
    globalThis.fetch = async (url, options) => {
      seen.push({ url: urlOf(url), options });
      return Response.json(catalog);
    };
    const models = await openRouterMediaAdapter.listModels(context);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://openrouter.ai/api/v1/models?output_modalities=transcription");
    expect(seen[0].options.headers.Authorization).toBe("Bearer sk-or-test");
    expect(models.map((model) => model.id)).toEqual([
      "openai/whisper-1",
      "openai/gpt-4o-mini-transcribe",
    ]);
    expect(models[0]).toMatchObject({
      capability: "speech.transcribe",
      title: "OpenAI: Whisper 1",
      input: ["audio"],
      output: ["text"],
      docs: "https://openrouter.ai/openai/whisper-1",
    });
    expect(models[0].description).toBeTruthy();
    expect(models[0].prices).toBeUndefined();

    await openRouterMediaAdapter.listModels(context);
    expect(seen).toHaveLength(1);
  });

  test("sends base64 audio and keeps the duration, tokens and actual charge", async () => {
    const seen = [];
    globalThis.fetch = async (url, options) => {
      seen.push({ url: urlOf(url), options });
      return Response.json({
        text: "  привет  ",
        usage: {
          seconds: 9.2,
          total_tokens: 113,
          input_tokens: 83,
          output_tokens: 30,
          cost: 0.000508,
        },
      });
    };
    const result = await openRouterMediaAdapter.submit(context, {
      capability: "speech.transcribe",
      model: "openai/whisper-1",
      input: { audio: { base64: "AQI=", mime: "audio/wav" } },
      options: { language: "ru", prompt: "Projector, CodeMirror" },
    });
    expect(seen[0].url).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    expect(seen[0].options.headers.Authorization).toBe("Bearer sk-or-test");
    expect(JSON.parse(seen[0].options.body)).toStrictEqual({
      model: "openai/whisper-1",
      input_audio: { data: "AQI=", format: "wav" },
      language: "ru",
      prompt: "Projector, CodeMirror",
    });
    expect(result).toMatchObject({
      status: "succeeded",
      artifacts: [{ kind: "text", mime: "text/plain", text: "привет" }],
      usage: { seconds: 9.2, inputTokens: 83, outputTokens: 30 },
      cost: { amount: 0.000508, currency: "USD" },
    });
  });

  test("reads the audio format from a data URI and a bare origin", async () => {
    const seen = [];
    globalThis.fetch = async (url, options) => {
      seen.push({ url: urlOf(url), options });
      return Response.json({ text: "ok" });
    };
    await openRouterMediaAdapter.submit(
      { ...context, url: "https://openrouter.ai" },
      {
        capability: "speech.transcribe",
        model: "openai/whisper-1",
        input: { audio: { base64: "data:audio/mpeg;base64,AQI=" } },
      },
    );
    expect(seen[0].url).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    expect(JSON.parse(seen[0].options.body).input_audio).toStrictEqual({
      data: "AQI=",
      format: "mp3",
    });
  });

  test("refuses an unknown audio format before calling the provider", async () => {
    globalThis.fetch = async () => {
      throw new Error("upstream must not be called");
    };
    await expect(
      openRouterMediaAdapter.submit(context, {
        capability: "speech.transcribe",
        model: "openai/whisper-1",
        input: { audio: { base64: "AQI=", mime: "audio/amr" } },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("keeps an authentication error instead of turning it into a generic failure", async () => {
    globalThis.fetch = async () =>
      Response.json({ error: { message: "No auth credentials found" } }, { status: 401 });
    await expect(
      openRouterMediaAdapter.submit(context, {
        capability: "speech.transcribe",
        model: "openai/whisper-1",
        input: { audio: { base64: "AQI=", mime: "audio/wav" } },
      }),
    ).rejects.toMatchObject({ status: 401, message: "No auth credentials found" });
  });
});

describe("transcribeMedia with an OpenRouter provider", () => {
  let directory;
  let previousEnv;
  const keys = ["XDG_DATA_HOME", "OPENAI_URL", "OPENAI_API_KEY", "DASHSCOPE_API_KEY", "QWEN_URL"];

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "projector-openrouter-"));
    previousEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    process.env.XDG_DATA_HOME = directory;
    delete process.env.OPENAI_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.QWEN_URL;
    const items = new Map();
    useProviderVault(
      createVault(
        {
          available: async () => true,
          get: async (key) => items.get(key.account),
          set: async (key, _label, value) => void items.set(key.account, value),
          delete: async (key) => void items.delete(key.account),
        },
        () => undefined,
      ),
    );
    await saveProviders(
      {
        activeProviderId: "openrouter",
        providers: [
          {
            id: "openrouter",
            name: "OpenRouter",
            kind: "openrouter",
            url: "https://openrouter.ai/api/v1",
            models: [{ id: "openai/whisper-1", alias: "openai/whisper-1" }],
            apiKey: "sk-or-test",
          },
        ],
      },
      {},
    );
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });

  test("uses usage.cost instead of asking for a rate card", async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(urlOf(url));
      if (urlOf(url).endsWith("/audio/transcriptions"))
        return Response.json({ text: "готово", usage: { seconds: 2, cost: 0.0002 } });
      throw new Error("the catalog must not be read for a reported charge");
    };
    const result = await transcribeMedia({
      providerId: "openrouter",
      model: "openai/whisper-1",
      audio: { base64: "AQI=", mime: "audio/wav" },
    });
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({
      text: "готово",
      providerId: "openrouter",
      model: "openai/whisper-1",
      contextSent: false,
      cost: { amount: 0.0002, currency: "USD" },
    });
  });
});
