import { createServer } from "node:http";
import { expect, test } from "vite-plus/test";
import {
  QWENCLOUD_LEGACY_DEFAULT_URL,
  QWENCLOUD_URL_EXAMPLE,
  qwenCloudEndpoint,
  qwenCloudEndpointOrNull,
} from "@ai-projector/core/modules/providers/index.ts";
import { fetchRemoteModels, pickModel, sanitizeModels } from "../modules/providers/models.ts";
import { providerBaseUrl } from "../modules/providers/openai-client.ts";
import { seededConfig } from "../modules/providers/provider-seeds.ts";

test("registered models get unique aliases and migrate the single legacy model", () => {
  expect(sanitizeModels([{ id: "a" }, { id: "b", alias: "a" }, { id: "c", alias: "x" }])).toEqual([
    { id: "a", alias: "a" },
    { id: "c", alias: "x" },
  ]);
  expect(sanitizeModels(undefined, "m")).toEqual([{ id: "m", alias: "m" }]);
  const models = sanitizeModels([{ id: "a" }, { id: "b", alias: "fast" }]);
  expect(pickModel(models, "fast")?.id).toBe("b");
  expect(pickModel(models, "nope")?.id).toBe("a");
  expect(pickModel([], "x")).toBeNull();
});

test("the model list is read from an OpenAI-style /models answer", async () => {
  let auth;
  const server = createServer((req, res) => {
    auth = req.headers.authorization;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "z" }, { id: "a" }, { id: "a" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    expect(await fetchRemoteModels(url, "k")).toEqual(["a", "z"]);
    expect(auth).toBe("Bearer k");
  } finally {
    server.close();
  }
});

test("QwenCloud endpoints keep chat and media bases apart", () => {
  for (const url of [
    "https://ap-southeast-1.maas.qwencloudapi.com",
    "https://ap-southeast-1.maas.qwencloudapi.com/api/v1",
    "https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1",
  ]) {
    expect(qwenCloudEndpoint(url)).toStrictEqual({
      origin: "https://ap-southeast-1.maas.qwencloudapi.com",
      region: "ap-southeast-1",
      openAiBase: "https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1",
      apiBase: "https://ap-southeast-1.maas.qwencloudapi.com/api/v1",
      legacy: false,
    });
  }
  const legacy = qwenCloudEndpoint(QWENCLOUD_LEGACY_DEFAULT_URL);
  expect(legacy.legacy).toBe(true);
  expect(legacy.region).toBe("");
  expect(legacy.openAiBase).toBe("https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
  expect(qwenCloudEndpointOrNull("")).toBeNull();
  expect(qwenCloudEndpointOrNull("not a url")).toBeNull();
  expect(() => qwenCloudEndpoint("not a url")).toThrow();
  expect(QWENCLOUD_URL_EXAMPLE).toContain("{region}");

  // A proxy keeps its own path; only the known QwenCloud suffixes are remapped.
  const proxy = qwenCloudEndpoint("https://proxy.example.com/qwen/compatible-mode/v1");
  expect(proxy.openAiBase).toBe("https://proxy.example.com/qwen/compatible-mode/v1");
  expect(proxy.apiBase).toBe("https://proxy.example.com/qwen/api/v1");
  expect(qwenCloudEndpoint("https://proxy.example.com/qwen/chat").openAiBase).toBe(
    "https://proxy.example.com/qwen/chat",
  );
  expect(
    qwenCloudEndpoint("https://ap-southeast-1.maas.qwencloudapi.com/apps/anthropic").openAiBase,
  ).toBe("https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1");

  expect(providerBaseUrl("qwencloud", "https://ap-southeast-1.maas.qwencloudapi.com")).toBe(
    "https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1",
  );
  expect(providerBaseUrl("qwencloud", QWENCLOUD_LEGACY_DEFAULT_URL)).toBe(
    QWENCLOUD_LEGACY_DEFAULT_URL,
  );
  expect(providerBaseUrl("custom", "https://api.example.com")).toBe("https://api.example.com/v1");
  // No region is chosen for the user, so a fresh install has no endpoint to misroute.
  expect(seededConfig({}).providers[0]).toMatchObject({ kind: "qwencloud", url: "" });
});

test("the QwenCloud model list is read under the compatible-mode base", async () => {
  let path;
  const server = createServer((req, res) => {
    path = req.url;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "qwen3.8-flash" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    expect(await fetchRemoteModels(url, "k", "qwencloud")).toEqual(["qwen3.8-flash"]);
    expect(path).toBe("/compatible-mode/v1/models");
  } finally {
    server.close();
  }
});

test("model thinking: only an explicit refusal is kept", () => {
  expect(
    sanitizeModels([{ id: "a", thinking: false }, { id: "b", thinking: true }, { id: "c" }]),
  ).toEqual([
    { id: "a", alias: "a", thinking: false },
    { id: "b", alias: "b" },
    { id: "c", alias: "c" },
  ]);
});
