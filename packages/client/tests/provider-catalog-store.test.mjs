import { afterEach, expect, test, vi } from "vite-plus/test";
import { useProviders } from "../modules/provider/index.ts";

const provider = {
  id: "qwen",
  name: "qwen-cloud",
  kind: "qwencloud",
  thinkingStyle: "qwen",
  url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  enabled: true,
  models: [],
  hasApiKey: true,
};

function stub(models, details) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init = {}) => {
      const href = String(url);
      if (href === "/api/providers")
        return {
          ok: true,
          json: async () => ({ activeProviderId: "qwen", providers: [provider] }),
        };
      if (href === "/api/providers/models")
        return { ok: true, json: async () => ({ models, details }) };
      return { ok: false, json: async () => ({ error: `нет маршрута ${href} ${init.method}` }) };
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

test("registering a listed model prefills its window and tariff from the catalog", async () => {
  stub(["qwen3.7-flash", "mystery"], {
    "qwen3.7-flash": {
      id: "qwen3.7-flash",
      description: "Быстрая модель",
      contextTokens: 1_000_000,
      price: { input: 0.03, output: 0.13 },
    },
  });
  const providers = useProviders();
  await providers.load();
  await providers.fetchModels("qwen");
  expect(providers.remoteModels.value.qwen).toEqual(["qwen3.7-flash", "mystery"]);

  providers.registerModel("qwen", "qwen3.7-flash");
  providers.registerModel("qwen", "mystery");
  const [known, unknown] = providers.providers.value[0].models;
  expect(known).toMatchObject({
    id: "qwen3.7-flash",
    alias: "qwen3.7-flash",
    contextTokens: 1_000_000,
    price: { input: 0.03, output: 0.13 },
  });
  expect(unknown.contextTokens).toBeUndefined();
  expect(unknown.price).toBeUndefined();
});

test("a manual price can be restored from the catalog", async () => {
  stub(["qwen3.7-flash"], {
    "qwen3.7-flash": {
      id: "qwen3.7-flash",
      contextTokens: 1_000_000,
      price: { input: 0.03, output: 0.13 },
    },
  });
  const providers = useProviders();
  await providers.load();
  await providers.fetchModels("qwen");
  providers.registerModel("qwen", "qwen3.7-flash");
  providers.setModelPrice("qwen", "qwen3.7-flash", "input", 99);
  providers.setModelContext("qwen", "qwen3.7-flash", 1000);
  providers.applyCatalogMetadata("qwen", "qwen3.7-flash");
  expect(providers.providers.value[0].models[0]).toMatchObject({
    contextTokens: 1_000_000,
    price: { input: 0.03, output: 0.13 },
  });
});
