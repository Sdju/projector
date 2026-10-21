import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

test("a provider keeps its fallback model and resolves it to the upstream id", async () => {
  const { saveProviders, resolveOpenAIProvider, useProviderVault } =
    await import("../server/modules/providers/index.ts");
  const { createVault } = await import("../server/modules/secrets/index.ts");
  const keyring = new Map();
  useProviderVault(
    createVault(
      {
        available: async () => true,
        get: async (key) => keyring.get(key.account),
        set: async (key, _label, value) => void keyring.set(key.account, value),
        delete: async (key) => void keyring.delete(key.account),
      },
      () => undefined,
    ),
  );
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), "projector-fallback-"));
  try {
    await saveProviders({
      activeProviderId: "p",
      providers: [
        {
          id: "p",
          name: "P",
          url: "http://127.0.0.1:1",
          apiKey: "k",
          fallbackModel: "small",
          models: [
            { id: "big-id", alias: "big" },
            { id: "small-id", alias: "small", thinking: false },
          ],
        },
      ],
    });
    const resolved = await resolveOpenAIProvider({ providerId: "p", model: "big" });
    expect(resolved.model).toBe("big-id");
    expect(resolved.fallback).toEqual({ model: "small-id", modelName: "small", thinking: false });

    await saveProviders({
      activeProviderId: "p",
      providers: [{ id: "p", name: "P", url: "http://127.0.0.1:1", fallbackModel: "" }],
    });
    expect((await resolveOpenAIProvider({ providerId: "p" })).fallback).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
  }
});
