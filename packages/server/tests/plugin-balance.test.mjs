import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { dataDir, providersPath } from "../../core/modules/app-paths/index.ts";
import { ensureAgentsReady, registerBuiltinAgents, syncPluginAgents } from "../app/agents.ts";
import {
  discoverPlugins,
  installPlugin,
  pluginsDirectory,
  removePlugin,
  setPluginEnabled,
  trustPlugin,
} from "../modules/plugins/index.ts";
import {
  pluginBalanceKinds,
  providerBalances,
  saveProviders,
  useProviderVault,
} from "../modules/providers/index.ts";
import { createVault } from "../modules/secrets/index.ts";

const fixture = fileURLToPath(new URL("fixtures/balance-plugin", import.meta.url));
const pluginId = "@projector-tests/balance-plugin";
const kind = "fixturebalance";

let directory;
const previous = {
  data: process.env.XDG_DATA_HOME,
  openaiUrl: process.env.OPENAI_URL,
  openaiKey: process.env.OPENAI_API_KEY,
};

function fakeKeyring() {
  const items = new Map();
  return {
    items,
    available: async () => true,
    get: async (key) => items.get(key.account),
    set: async (key, _label, value) => void items.set(key.account, value),
    delete: async (key) => void items.delete(key.account),
  };
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "projector-plugin-balance-"));
  process.env.XDG_DATA_HOME = directory;
  delete process.env.OPENAI_URL;
  delete process.env.OPENAI_API_KEY;
  useProviderVault(createVault(fakeKeyring(), () => undefined));
  await rm(pluginsDirectory(), { recursive: true, force: true });
  await rm(join(dataDir(), "plugins.json"), { force: true });
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
  for (const [key, value] of [
    ["XDG_DATA_HOME", previous.data],
    ["OPENAI_URL", previous.openaiUrl],
    ["OPENAI_API_KEY", previous.openaiKey],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("a balance-only server plugin registers its kind and reader", async () => {
  const source = join(directory, "balance");
  await cp(fixture, source, { recursive: true });
  await installPlugin(source);
  await trustPlugin(pluginId);
  await setPluginEnabled(pluginId, true);

  registerBuiltinAgents();
  await ensureAgentsReady();
  await syncPluginAgents();

  expect(pluginBalanceKinds().map((entry) => entry.kind)).toContain(kind);
  expect(pluginBalanceKinds().find((entry) => entry.kind === kind)).toMatchObject({
    title: "Fixture Balance",
    url: "https://fixture.test/v1",
    model: "fixture-model",
  });

  await saveProviders(
    {
      activeProviderId: "fixture",
      providers: [
        {
          id: "fixture",
          name: "Fixture Wallet",
          kind,
          url: "https://fixture.test/v1",
          models: [{ id: "fixture-model", alias: "fixture-model" }],
          apiKey: "sk-fixture",
        },
      ],
    },
    {},
  );

  const wallets = await providerBalances();
  expect(wallets).toHaveLength(1);
  expect(wallets[0]).toMatchObject({
    providerId: "fixture",
    providerKind: kind,
    status: "ready",
    available: true,
  });
  expect(wallets[0].entries).toEqual([
    { currency: "USD", total: "3.50", granted: "0", toppedUp: "3.50" },
  ]);

  const catalog = await setPluginEnabled(pluginId, false);
  await syncPluginAgents();
  expect(catalog.plugins.find((plugin) => plugin.id === pluginId)?.status).toBe("disabled");
  expect(pluginBalanceKinds().map((entry) => entry.kind)).not.toContain(kind);
  expect(await providerBalances()).toHaveLength(0);
});

test("the balance kind is declared in the catalog and disappears after removal", async () => {
  let catalog = await discoverPlugins();
  const plugin = catalog.plugins.find((entry) => entry.id === pluginId);
  if (!plugin) return;
  expect(plugin.balances.map((entry) => entry.kind)).toEqual([kind]);
  await removePlugin(pluginId);
  catalog = await discoverPlugins();
  expect(catalog.plugins.find((entry) => entry.id === pluginId)).toBeUndefined();
  expect(pluginBalanceKinds().map((entry) => entry.kind)).not.toContain(kind);
  await rm(providersPath(), { force: true });
});
