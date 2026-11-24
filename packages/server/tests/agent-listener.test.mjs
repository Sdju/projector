import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import "../../../tests/helpers/builtins.mjs";
import { handleApi } from "../app/api.ts";
import { providersPath } from "../../core/modules/app-paths/index.ts";
import { closeHistoryStore } from "../modules/agent/history-store.ts";
import { wavDurationSeconds } from "../modules/media/index.ts";
import { closeSpendStore, taskSpend } from "../modules/spend/index.ts";

/** A provider that answers transcription and keeps the multipart body for the assertions. */
async function stubProvider() {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({ url: req.url, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text: "привет, Projector" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

async function withServer(run) {
  const directory = await mkdtemp(join(tmpdir(), "projector-listener-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  const provider = await stubProvider();
  const server = createServer((req, res) => {
    void handleApi(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ origin, directory, provider });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await provider.close();
    closeHistoryStore();
    closeSpendStore();
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const audio = Buffer.from("RIFF-listener-test").toString("base64");

/** A real 16 kHz mono PCM WAV: the server reads its duration from the data chunk. */
function wav(seconds) {
  const samples = Math.round(16_000 * seconds);
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + samples * 2, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  return bytes.toString("base64");
}

test("listener resolves the first recognition model and transcribes without an artifact", async () => {
  await withServer(async ({ origin, directory, provider }) => {
    await mkdir(join(directory, "projector"), { recursive: true });
    await writeFile(
      providersPath(),
      JSON.stringify({
        activeProviderId: "stub",
        providers: [
          {
            id: "stub",
            name: "Stub",
            kind: "custom",
            thinkingStyle: "none",
            url: provider.origin,
            enabled: true,
            models: [],
          },
        ],
      }),
      "utf8",
    );

    const state = await (await fetch(`${origin}/api/agent/listener`)).json();
    expect(state).toMatchObject({
      configured: true,
      providerId: "stub",
      providerName: "Stub",
      model: "whisper-1",
      auto: true,
      context: "",
    });

    const response = await fetch(`${origin}/api/agent/listener/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ audio: { base64: audio, mime: "audio/wav" } }),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      text: "привет, Projector",
      providerId: "stub",
      model: "whisper-1",
      contextSent: false,
    });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].url).toBe("/v1/audio/transcriptions");

    // The recording is read in memory: no media job and no file on disk.
    await expect(stat(join(directory, "projector", "media"))).rejects.toThrow();
  });
});

test("listener sends the chosen model and the role context as a hint", async () => {
  await withServer(async ({ origin, directory, provider }) => {
    await mkdir(join(directory, "projector"), { recursive: true });
    await writeFile(
      providersPath(),
      JSON.stringify({
        activeProviderId: "stub",
        providers: [
          {
            id: "stub",
            name: "Stub",
            kind: "custom",
            thinkingStyle: "none",
            url: provider.origin,
            enabled: true,
            models: [],
          },
        ],
      }),
      "utf8",
    );

    const saved = await fetch(`${origin}/api/agent/roles/listener`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        selection: { provider: "stub:gpt-4o-mini-transcribe" },
        prompt: "Projector, Sdju, TypeScript",
      }),
    });
    expect(saved.status).toBe(200);

    const response = await fetch(`${origin}/api/agent/listener/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        audio: { base64: audio, mime: "audio/wav" },
        language: "ru",
        hints: "епта",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      text: "привет, Projector",
      model: "gpt-4o-mini-transcribe",
      contextSent: true,
    });
    const body = provider.requests[0].body;
    expect(body).toContain("gpt-4o-mini-transcribe");
    expect(body).toContain("Projector, Sdju, TypeScript");
    expect(body).toContain("епта");
    expect(body).toContain("ru");

    const state = await (await fetch(`${origin}/api/agent/listener`)).json();
    expect(state).toMatchObject({
      model: "gpt-4o-mini-transcribe",
      auto: false,
      context: "Projector, Sdju, TypeScript",
    });
  });
});

test("listener records dictation at the recognition model's rate", async () => {
  await withServer(async ({ origin, directory, provider }) => {
    expect(wavDurationSeconds(wav(6), "audio/wav")).toBeCloseTo(6, 5);
    expect(wavDurationSeconds(audio, "audio/wav")).toBeUndefined();
    await mkdir(join(directory, "projector"), { recursive: true });
    await writeFile(
      providersPath(),
      JSON.stringify({
        activeProviderId: "stub",
        providers: [
          {
            id: "stub",
            name: "Stub",
            kind: "custom",
            thinkingStyle: "none",
            url: provider.origin,
            enabled: true,
            models: [],
          },
        ],
      }),
      "utf8",
    );

    const response = await fetch(`${origin}/api/agent/listener/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ audio: { base64: wav(6), mime: "audio/wav" } }),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.usage.seconds).toBeCloseTo(6, 5);
    expect(result.cost.currency).toBe("USD");
    expect(result.cost.amount).toBeCloseTo(0.0006, 10);

    const dictation = taskSpend(0).byTask.find((item) => item.key === "dictation");
    expect(dictation).toMatchObject({ answers: 1, tokens: 0 });
    expect(dictation.cost).toBeCloseTo(0.0006, 10);
    expect(taskSpend(0).calls).toBe(1);
  });
});

test("listener refuses writes without the page origin and empty audio", async () => {
  await withServer(async ({ origin }) => {
    const denied = await fetch(`${origin}/api/agent/listener/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: { base64: audio, mime: "audio/wav" } }),
    });
    expect(denied.status).toBe(403);

    const empty = await fetch(`${origin}/api/agent/listener/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ audio: { mime: "audio/wav" } }),
    });
    expect(empty.status).toBe(400);
  });
});
