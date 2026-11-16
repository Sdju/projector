import { expect, test } from "vite-plus/test";
import { createCommandService } from "../../core/modules/ide/index.ts";
import { registerMediaCommands } from "../modules/media/model/commands.ts";

const job = {
  id: "job-1",
  status: "succeeded",
  capability: "image.generate",
  providerId: "p1",
  providerName: "Provider",
  adapter: "custom",
  model: "image-1",
  artifacts: [
    {
      kind: "image",
      mime: "image/png",
      fileId: "file.png",
      fileUrl: "/api/media/files/file.png",
    },
  ],
  widget: '<Media jobId="job-1" />',
  createdAt: 1,
  updatedAt: 2,
};

function mediaCommands() {
  const sdk = createCommandService();
  const scope = sdk.createScope("media", () => ({ surface: "media" }));
  registerMediaCommands(scope);
  return scope;
}

test("media commands load models and generate without the tab", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    calls.push({ url: href, body: init?.body ? JSON.parse(init.body) : undefined });
    if (href === "/api/media") return Response.json({ providers: [{ id: "p1" }], adapters: [] });
    if (href.startsWith("/api/media/models"))
      return Response.json({ models: [{ id: "image-1", capability: "image.generate" }] });
    if (href === "/api/media/generate") return Response.json(job);
    if (href === "/api/media/jobs/job-1") return Response.json(job);
    throw new Error(`unexpected ${href}`);
  };
  const scope = mediaCommands();

  const models = await scope.executeCommand("ide.media.models.refresh", {});
  expect(models.models[0].id).toBe("image-1");
  expect(models.state.providers[0].id).toBe("p1");

  const generated = await scope.executeCommand("ide.media.generate", {
    capability: "image.generate",
    model: "image-1",
    prompt: "кот",
    options: { size: "1024*1024" },
  });
  expect(generated.widget).toBe('<Media jobId="job-1" />');
  expect(calls.at(-1).body).toStrictEqual({
    capability: "image.generate",
    model: "image-1",
    prompt: "кот",
    options: { size: "1024*1024" },
  });

  const fetched = await scope.executeCommand("ide.media.job.refresh", { id: "job-1" });
  expect(fetched.artifacts[0].fileUrl).toBe("/api/media/files/file.png");
  await expect(scope.executeCommand("ide.media.job.refresh", {})).rejects.toThrow(/недоступна/);
});

test("media generate accepts an input source and rejects an unknown capability", async () => {
  let body;
  globalThis.fetch = async (url, init) => {
    body = JSON.parse(init.body);
    return Response.json({ ...job, capability: "speech.transcribe" });
  };
  const scope = mediaCommands();
  await scope.executeCommand("ide.media.generate", {
    capability: "speech.transcribe",
    model: "asr-1",
    audioUrl: "https://example.com/a.wav",
    input: { audio: { url: "https://example.com/b.wav" } },
  });
  expect(body.input).toStrictEqual({ audio: { url: "https://example.com/a.wav" } });
  await expect(
    scope.executeCommand("ide.media.generate", { capability: "nope", model: "m" }),
  ).rejects.toThrow(/медиа-возможность/);
});
