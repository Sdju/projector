import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { mediaJobView } from "@ai-projector/core/modules/media/index.ts";
import { createRouteDispatcher, readBody } from "../modules/transport/index.ts";
import { routes } from "../routes/api/media.ts";
import { saveProviders, useProviderVault } from "../modules/providers/index.ts";
import { createVault } from "../modules/secrets/index.ts";
import { resetMediaArtifacts } from "../modules/media/artifacts.ts";
import { resetMediaJobs } from "../modules/media/jobs.ts";
import { cancelMediaJob, mediaFile, mediaJob } from "../modules/media/service.ts";
import { registerBuiltinMediaAdapters } from "../app/media-adapters.ts";
import {
  normalizeQwenCloudOrigin,
  parseQwenAudio,
  parseQwenImages,
  parseQwenTask,
  parseQwenText,
  qwenApiBase,
} from "../modules/media-qwencloud/index.ts";
import { qwencloudAdapter, qwencloudModels } from "../modules/media-qwencloud/index.ts";
import { openAiMediaAdapter } from "../modules/media-openai/index.ts";

registerBuiltinMediaAdapters();

const handle = createRouteDispatcher(routes);

function request(body) {
  return {
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    },
  };
}

function response() {
  const headers = {};
  let body;
  return {
    res: {
      statusCode: 200,
      setHeader(key, value) {
        headers[key] = value;
      },
      end(value) {
        body = value;
      },
      destroy() {},
    },
    headers,
    body: () => JSON.parse(body),
  };
}

async function call(method, path, init = {}) {
  const { res, headers, body } = response();
  const url = new URL(`http://localhost${path}`);
  await handle({
    req: init.req ?? request(init.body ?? {}),
    res,
    url,
    method,
    path: url.pathname,
  });
  return { status: res.statusCode, headers, body: body() };
}

describe("QwenCloud parsing", () => {
  test("accepts the new and old QwenCloud origins", () => {
    expect(normalizeQwenCloudOrigin("https://ap-southeast-1.maas.qwencloudapi.com")).toBe(
      "https://ap-southeast-1.maas.qwencloudapi.com",
    );
    expect(qwenApiBase("https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1")).toBe(
      "https://ap-southeast-1.maas.qwencloudapi.com/api/v1",
    );
    expect(qwenApiBase("https://dashscope-intl.aliyuncs.com/compatible-mode/v1")).toBe(
      "https://dashscope-intl.aliyuncs.com/api/v1",
    );
    expect(() => normalizeQwenCloudOrigin("not a url")).toThrow();
  });

  test("reads images, audio, text and async tasks", () => {
    const images = parseQwenImages({
      output: {
        choices: [{ message: { content: [{ image: "https://cdn.aliyuncs.com/a.png" }] } }],
      },
    });
    expect(images).toStrictEqual([
      { kind: "image", mime: "image/png", url: "https://cdn.aliyuncs.com/a.png" },
    ]);
    expect(
      parseQwenImages({ output: { results: [{ url: "https://cdn.aliyuncs.com/b.png" }] } }),
    ).toHaveLength(1);
    expect(
      parseQwenAudio({
        output: { audio: { url: "https://cdn.aliyuncs.com/a.mp3", expires_at: 10 } },
      }),
    ).toStrictEqual({
      kind: "audio",
      mime: "audio/mpeg",
      url: "https://cdn.aliyuncs.com/a.mp3",
      expiresAt: 10,
    });
    expect(parseQwenText({ output: { text: "привет" } })).toBe("привет");
    expect(
      parseQwenTask({
        output: {
          task_id: "t1",
          task_status: "SUCCEEDED",
          video_url: "https://cdn.aliyuncs.com/v.mp4",
        },
      }),
    ).toStrictEqual({
      status: "succeeded",
      upstreamId: "t1",
      artifacts: [{ kind: "video", mime: "video/mp4", url: "https://cdn.aliyuncs.com/v.mp4" }],
    });
    expect(parseQwenTask({ output: { task_status: "RUNNING", task_progress: 40 } })).toStrictEqual({
      status: "running",
      progress: 0.4,
    });
    expect(
      parseQwenTask({
        output: { task_status: "FAILED", code: "InvalidParameter", message: "bad size" },
      }).error,
    ).toMatch(/InvalidParameter: bad size/);
    expect(qwencloudModels().some((model) => model.id === "qwen-image-3.0-pro")).toBe(true);
  });

  test("sends the audio format required by Qwen ASR", async () => {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      expect(body.parameters).toMatchObject({ format: "wav", sample_rate: "16000" });
      expect(body.input.messages[0].content[0].input_audio.data).toMatch(
        /^data:audio\/wav;base64,/,
      );
      return Response.json({ output: { text: "привет" } });
    };
    const result = await qwencloudAdapter.submit(
      {
        id: "qwen",
        name: "Qwen",
        kind: "qwencloud",
        url: "https://ap-southeast-1.maas.qwencloudapi.com",
        apiKey: "sk-test",
        signal: AbortSignal.timeout(5000),
      },
      {
        capability: "speech.transcribe",
        model: "qwen-audio-3.1-asr-flash",
        input: { audio: { base64: "UklGRg==", mime: "audio/wav" } },
        options: { sample_rate: "16000" },
      },
    );
    expect(result.artifacts[0].text).toBe("привет");
  });
});

describe("agent media view", () => {
  const job = {
    id: "job-1",
    status: "succeeded",
    capability: "image.generate",
    providerId: "p1",
    providerName: "Provider",
    adapter: "custom",
    model: "m1",
    artifacts: [
      { kind: "image", mime: "image/png", fileId: "abc.png", url: "https://cdn.example/a.png" },
      { kind: "text", mime: "text/plain", text: "привет" },
    ],
    createdAt: 1,
    updatedAt: 2,
  };

  test("adds file links and a ready widget tag", () => {
    const view = mediaJobView(job);
    expect(view.artifacts[0].fileUrl).toBe("/api/media/files/abc.png");
    expect(view.artifacts[1].fileUrl).toBeUndefined();
    expect(view.widget).toBe('<Media jobId="job-1" />');
    expect(mediaJobView(job, { baseUrl: "http://localhost:4177/" }).artifacts[0].fileUrl).toBe(
      "http://localhost:4177/api/media/files/abc.png",
    );
  });

  test("leaves a running job without a widget", () => {
    const view = mediaJobView({ ...job, status: "running", artifacts: [] });
    expect(view.widget).toBeUndefined();
    expect(view.artifacts).toStrictEqual([]);
  });
});

describe("OpenAI-compatible media adapter", () => {
  const context = {
    id: "openai",
    name: "OpenAI",
    kind: "custom",
    url: "https://api.example.com",
    apiKey: "sk-openai",
    signal: AbortSignal.timeout(5000),
  };

  test("maps image, speech and transcription to the same contract", async () => {
    globalThis.fetch = async (url, options) => {
      if (String(url) === "https://api.example.com/v1/images/generations") {
        expect(options.headers.Authorization).toBe("Bearer sk-openai");
        expect(JSON.parse(options.body).model).toBe("gpt-image-1");
        return Response.json({ data: [{ url: "https://cdn.aliyuncs.com/o.png" }] });
      }
      if (String(url) === "https://api.example.com/v1/audio/speech")
        return new Response(new Uint8Array([1, 2]), {
          headers: { "content-type": "audio/mpeg" },
        });
      if (String(url) === "https://api.example.com/v1/audio/transcriptions") {
        expect(options.body).toBeInstanceOf(FormData);
        expect(options.body.get("model")).toBe("whisper-1");
        expect(options.body.get("file")).toBeTruthy();
        return Response.json({ text: "hello" });
      }
      throw new Error(`unexpected ${url}`);
    };
    const image = await openAiMediaAdapter.submit(context, {
      capability: "image.generate",
      model: "gpt-image-1",
      prompt: "кот",
    });
    expect(image.artifacts).toStrictEqual([
      { kind: "image", mime: "image/png", url: "https://cdn.aliyuncs.com/o.png" },
    ]);
    const speech = await openAiMediaAdapter.submit(context, {
      capability: "speech.synthesize",
      model: "gpt-4o-mini-tts",
      input: { text: "привет" },
    });
    expect(speech.artifacts[0]).toStrictEqual({
      kind: "audio",
      mime: "audio/mpeg",
      base64: "AQI=",
    });
    const text = await openAiMediaAdapter.submit(context, {
      capability: "speech.transcribe",
      model: "whisper-1",
      input: { audio: { base64: "AQI=", mime: "audio/mpeg" } },
    });
    expect(text.artifacts).toStrictEqual([{ kind: "text", mime: "text/plain", text: "hello" }]);
    expect(openAiMediaAdapter.listModels(context).map((model) => model.id)).toContain(
      "gpt-image-1",
    );
  });

  test("rejects oversized streamed audio before buffering it", async () => {
    globalThis.fetch = async () =>
      new Response(new Uint8Array([1]), {
        headers: { "content-type": "audio/mpeg", "content-length": String(65 * 1024 * 1024) },
      });
    await expect(
      openAiMediaAdapter.submit(context, {
        capability: "speech.synthesize",
        model: "gpt-4o-mini-tts",
        input: { text: "привет" },
      }),
    ).rejects.toMatchObject({ status: 413 });
  });
});

describe("media API with a QwenCloud provider", () => {
  let directory;
  let previousFetch;
  let previousEnv;
  const keys = ["XDG_DATA_HOME", "OPENAI_URL", "OPENAI_API_KEY", "DASHSCOPE_API_KEY", "QWEN_URL"];

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "projector-media-"));
    previousFetch = globalThis.fetch;
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
        activeProviderId: "qwen",
        providers: [
          {
            id: "qwen",
            name: "QwenCloud",
            kind: "qwencloud",
            url: "https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1",
            models: [{ id: "qwen3.8-flash", alias: "qwen3.8-flash" }],
            apiKey: "sk-test",
          },
        ],
      },
      {},
    );
  });

  afterAll(async () => {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetMediaArtifacts();
    resetMediaJobs();
    await rm(directory, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetMediaArtifacts();
    resetMediaJobs();
  });

  test("lists providers and models without reading media keys", async () => {
    const state = await call("GET", "/api/media");
    expect(state.body.providers).toStrictEqual([
      {
        id: "qwen",
        name: "QwenCloud",
        kind: "qwencloud",
        capabilities: [
          "image.generate",
          "speech.synthesize",
          "speech.transcribe",
          "video.generate",
        ],
      },
    ]);
    const models = await call("GET", "/api/media/models?capability=image.generate");
    expect(models.body.models.map((model) => model.id)).toContain("qwen-image-3.0-pro");
    expect(models.body.models[0].providerId).toBe("qwen");
    expect(models.body.models[0].adapter).toBe("qwencloud");
  });

  test("generates an image, downloads it and never leaks the key", async () => {
    const seen = [];
    globalThis.fetch = async (url, options) => {
      seen.push({ url: String(url), options });
      if (String(url).endsWith("/services/aigc/multimodal-generation/generation")) {
        expect(options.headers.Authorization).toBe("Bearer sk-test");
        const body = JSON.parse(options.body);
        expect(body.model).toBe("qwen-image-3.0-pro");
        expect(body.parameters.size).toBe("1024*1024");
        return Response.json({
          output: {
            choices: [{ message: { content: [{ image: "https://cdn.aliyuncs.com/a.png" }] } }],
          },
          request_id: "r1",
        });
      }
      if (String(url) === "https://cdn.aliyuncs.com/a.png")
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png", "content-length": "4" },
        });
      throw new Error(`unexpected ${url}`);
    };
    const result = await call("POST", "/api/media/generate", {
      body: {
        capability: "image.generate",
        providerId: "qwen",
        model: "qwen-image-3.0-pro",
        prompt: "кот",
        options: { size: "1024x1024" },
      },
    });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("succeeded");
    expect(result.body.artifacts).toHaveLength(1);
    const [artifact] = result.body.artifacts;
    expect(artifact.kind).toBe("image");
    expect(artifact.mime).toBe("image/png");
    expect(artifact.url).toBe("https://cdn.aliyuncs.com/a.png");
    expect(JSON.stringify(result.body)).not.toMatch(/sk-test/);
    const file = await mediaFile(artifact.fileId);
    expect((await readFile(file.path)).equals(Buffer.from([137, 80, 78, 71]))).toBe(true);
    expect(seen).toHaveLength(2);
  });

  test("runs a video task and serves the cached artifact", async () => {
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith("/services/aigc/video-generation/video-synthesis")) {
        expect(options.headers["X-DashScope-Async"]).toBe("enable");
        const body = JSON.parse(options.body);
        expect(body.input.prompt).toBe("волна");
        expect(body.parameters.resolution).toBe("720P");
        return Response.json({ output: { task_id: "task-1", task_status: "PENDING" } });
      }
      if (String(url).endsWith("/api/v1/tasks/task-1"))
        return Response.json({
          output: {
            task_id: "task-1",
            task_status: "SUCCEEDED",
            video_url: "https://cdn.aliyuncs.com/v.mp4",
          },
        });
      if (String(url) === "https://cdn.aliyuncs.com/v.mp4")
        return new Response(new Uint8Array([0, 0, 0, 1]), {
          headers: { "content-type": "video/mp4", "content-length": "4" },
        });
      throw new Error(`unexpected ${url}`);
    };
    const started = await call("POST", "/api/media/generate", {
      body: {
        capability: "video.generate",
        providerId: "qwen",
        model: "wan3.0-video",
        prompt: "волна",
        options: { resolution: "720P", duration: 5 },
      },
    });
    expect(started.status).toBe(202);
    expect(started.body.status).toBe("running");
    expect(started.headers.Location).toBe(`/api/media/jobs/${started.body.id}`);
    const finished = await call("GET", `/api/media/jobs/${started.body.id}`);
    expect(finished.status).toBe(200);
    expect(finished.body.status).toBe("succeeded");
    expect(finished.body.artifacts[0].kind).toBe("video");
    const file = await mediaFile(finished.body.artifacts[0].fileId);
    expect((await readFile(file.path)).equals(Buffer.from([0, 0, 0, 1]))).toBe(true);
  });

  test("reports provider errors without echoing secrets", async () => {
    globalThis.fetch = async () =>
      Response.json(
        { code: "InvalidApiKey", message: "Invalid API-key provided.", request_id: "r2" },
        { status: 401 },
      );
    await expect(
      call("POST", "/api/media/generate", {
        body: {
          capability: "image.generate",
          providerId: "qwen",
          model: "qwen-image-3.0-pro",
          prompt: "кот",
        },
      }),
    ).rejects.toThrow(/InvalidApiKey.*r2/);
  });

  test("validates model capabilities and limits request bodies", async () => {
    globalThis.fetch = async () => {
      throw new Error("upstream must not be called");
    };
    await expect(
      call("POST", "/api/media/generate", {
        body: {
          capability: "video.generate",
          providerId: "qwen",
          model: "qwen-image-3.0-pro",
          prompt: "кот",
        },
      }),
    ).rejects.toThrow(/не поддерживает video.generate/);
    await expect(readBody(request({ text: "12345" }), 4)).rejects.toMatchObject({ status: 413 });
  });

  test("rejects private and unapproved artifact hosts before downloading", async () => {
    for (const artifactUrl of ["https://cdn.example/a.png", "https://127.0.0.1/a.png"]) {
      const downloads = [];
      globalThis.fetch = async (url) => {
        if (String(url).endsWith("/services/aigc/multimodal-generation/generation"))
          return Response.json({
            output: { choices: [{ message: { content: [{ image: artifactUrl }] } }] },
          });
        downloads.push(String(url));
        return new Response(new Uint8Array([1]));
      };
      await expect(
        call("POST", "/api/media/generate", {
          body: {
            capability: "image.generate",
            providerId: "qwen",
            model: "qwen-image-3.0-pro",
            prompt: "кот",
          },
        }),
      ).rejects.toThrow(/недопустимый адрес|неразрешённого хоста/);
      expect(downloads).toHaveLength(0);
    }
  });

  test("does not retry a terminal result after an artifact error", async () => {
    let polls = 0;
    let downloads = 0;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/services/aigc/video-generation/video-synthesis"))
        return Response.json({ output: { task_id: "task-html", task_status: "PENDING" } });
      if (String(url).endsWith("/api/v1/tasks/task-html")) {
        polls++;
        return Response.json({
          output: {
            task_id: "task-html",
            task_status: "SUCCEEDED",
            video_url: "https://cdn.aliyuncs.com/v.mp4",
          },
        });
      }
      if (String(url) === "https://cdn.aliyuncs.com/v.mp4") {
        downloads++;
        return new Response("<script>alert(1)</script>", {
          headers: { "content-type": "text/html" },
        });
      }
      throw new Error(`unexpected ${url}`);
    };
    const started = await call("POST", "/api/media/generate", {
      body: {
        capability: "video.generate",
        providerId: "qwen",
        model: "wan3.0-video",
        prompt: "волна",
      },
    });
    await expect(mediaJob(started.body.id)).rejects.toThrow(/тип медиа-файла/);
    expect((await mediaJob(started.body.id)).status).toBe("failed");
    expect((await mediaJob(started.body.id)).error).toMatch(/тип медиа-файла/);
    expect(polls).toBe(1);
    expect(downloads).toBe(1);
  });

  test("coalesces polling and serializes cancellation", async () => {
    let polls = 0;
    let cancellations = 0;
    let releasePoll;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/services/aigc/video-generation/video-synthesis"))
        return Response.json({ output: { task_id: "task-race", task_status: "PENDING" } });
      if (String(url).endsWith("/api/v1/tasks/task-race/cancel")) {
        cancellations++;
        return Response.json({ output: { task_id: "task-race", task_status: "CANCELED" } });
      }
      if (String(url).endsWith("/api/v1/tasks/task-race")) {
        polls++;
        return new Promise((resolve) => {
          releasePoll = () =>
            resolve(
              Response.json({
                output: { task_id: "task-race", task_status: "RUNNING", task_progress: 40 },
              }),
            );
        });
      }
      throw new Error(`unexpected ${url}`);
    };
    const started = await call("POST", "/api/media/generate", {
      body: {
        capability: "video.generate",
        providerId: "qwen",
        model: "wan3.0-video",
        prompt: "волна",
      },
    });
    const first = mediaJob(started.body.id);
    const second = mediaJob(started.body.id);
    const cancelling = cancelMediaJob(started.body.id);
    for (let attempt = 0; attempt < 20 && !releasePoll; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(polls).toBe(1);
    expect(cancellations).toBe(0);
    releasePoll();
    expect((await first).status).toBe("running");
    expect((await second).progress).toBe(0.4);
    expect((await cancelling).status).toBe("cancelled");
    expect((await mediaJob(started.body.id)).status).toBe("cancelled");
    expect(cancellations).toBe(1);
    expect(polls).toBe(1);
  });

  test("issues a temporary key for QwenCloud only", async () => {
    globalThis.fetch = async (url, options) => {
      expect(String(url)).toBe(
        "https://ap-southeast-1.maas.qwencloudapi.com/api/v1/tokens?expire_in_seconds=900",
      );
      expect(options.headers.Authorization).toBe("Bearer sk-test");
      return Response.json({ token: "st-123", expires_at: 99 });
    };
    const result = await call("POST", "/api/media/keys/temporary", {
      body: { providerId: "qwen", expiresIn: 900 },
    });
    expect(result.body).toStrictEqual({ token: "st-123", expiresAt: 99 });
    expect(result.headers["Cache-Control"]).toBe("no-store");
  });
});
