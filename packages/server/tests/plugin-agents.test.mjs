import { createServer } from "node:http";
import { once } from "node:events";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, expect, onTestFinished, test } from "vite-plus/test";
import { dataDir } from "../../core/modules/app-paths/index.ts";
import { listAgentBackends, resolveAgentBackend } from "../modules/agent/index.ts";
import {
  discoverPlugins,
  installPlugin,
  pluginsDirectory,
  removePlugin,
  setPluginEnabled,
  trustPlugin,
} from "../modules/plugins/index.ts";
import { ensureAgentsReady, registerBuiltinAgents, syncPluginAgents } from "../app/agents.ts";
import { handleApi } from "../app/api.ts";

const fixture = fileURLToPath(new URL("fixtures/agent-plugin", import.meta.url));
const pluginId = "@projector-tests/agent-plugin";
const agentId = "fixture-acp";

beforeEach(async () => {
  await rm(pluginsDirectory(), { recursive: true, force: true });
  await rm(join(dataDir(), "plugins.json"), { force: true });
});

async function tempFixture(mutate) {
  const directory = await mkdtemp(join(tmpdir(), "projector-plugin-agent-test-"));
  const source = join(directory, "agent");
  await cp(fixture, source, { recursive: true });
  if (mutate) {
    const path = join(source, "package.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    mutate(manifest);
    await writeFile(path, JSON.stringify(manifest, null, 2));
  }
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return source;
}

function pluginFrom(catalog) {
  return catalog.plugins.find((plugin) => plugin.id === pluginId);
}

async function apiServer() {
  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("install reports an agent plugin as disabled, untrusted and theme-less", async () => {
  const catalog = await installPlugin(await tempFixture());
  const plugin = pluginFrom(catalog);
  expect(plugin).toBeTruthy();
  expect(plugin.status).toBe("disabled");
  expect(plugin.enabled).toBe(false);
  expect(plugin.trusted).toBe(false);
  expect(plugin.agents).toHaveLength(1);
  expect(plugin.agents[0].id).toBe(agentId);
  expect(catalog.availableThemes).toEqual([]);
});

test("an agent plugin cannot be enabled before trust, and trust alone leaves it disabled", async () => {
  await installPlugin(await tempFixture());
  onTestFinished(async () => {
    await setPluginEnabled(pluginId, false).catch(() => undefined);
    await removePlugin(pluginId).catch(() => undefined);
  });
  await expect(setPluginEnabled(pluginId, true)).rejects.toThrow(/доверие/);

  let catalog = await trustPlugin(pluginId);
  let plugin = pluginFrom(catalog);
  expect(plugin.status).toBe("disabled");
  expect(plugin.enabled).toBe(false);
  expect(plugin.trusted).toBe(true);

  catalog = await setPluginEnabled(pluginId, true);
  plugin = pluginFrom(catalog);
  expect(plugin.status).toBe("enabled");
  expect(plugin.enabled).toBe(true);
  expect(plugin.trusted).toBe(true);
});

test("enabled plugin agents join the live registry and disappear on disable", async () => {
  await installPlugin(await tempFixture());
  onTestFinished(async () => {
    await removePlugin(pluginId).catch(() => undefined);
  });
  await trustPlugin(pluginId);
  await setPluginEnabled(pluginId, true);

  registerBuiltinAgents();
  // The composition starts discovery in the background; wait for it before asserting.
  await ensureAgentsReady();
  await syncPluginAgents();

  expect(listAgentBackends().some((backend) => backend.id === agentId)).toBe(true);
  expect(resolveAgentBackend(agentId)).toBe(agentId);

  await setPluginEnabled(pluginId, false);
  expect(listAgentBackends().some((backend) => backend.id === agentId)).toBe(false);
  expect(() => resolveAgentBackend(agentId)).toThrow(/Неизвестный агент/);
});

test("changed agent plugin content invalidates trust and keeps the plugin from enabling", async () => {
  await installPlugin(await tempFixture());
  onTestFinished(() => removePlugin(pluginId).catch(() => undefined));
  await trustPlugin(pluginId);
  let catalog = await setPluginEnabled(pluginId, true);
  const installed = pluginFrom(catalog);
  expect(installed.status).toBe("enabled");

  const manifestPath = join(installed.path, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.description = "Изменённое содержимое";
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  catalog = await discoverPlugins();
  const plugin = pluginFrom(catalog);
  expect(plugin.status).toBe("error");
  expect(plugin.trusted).toBe(false);
  expect(plugin.diagnostics.some((item) => /изменилось/.test(item.message))).toBe(true);
  await expect(setPluginEnabled(pluginId, true)).rejects.toThrow(/ошибки/);
});

test("removal deletes the managed installation and its saved state", async () => {
  const catalog = await installPlugin(await tempFixture());
  const installed = pluginFrom(catalog);

  const removed = await removePlugin(pluginId);
  const plugin = pluginFrom(removed);
  expect(plugin === undefined || plugin.status === "missing").toBe(true);
  await expect(readFile(join(installed.path, "package.json"), "utf8")).rejects.toThrow();

  const state = JSON.parse(await readFile(join(dataDir(), "plugins.json"), "utf8"));
  expect(state.plugins[pluginId]).toBeUndefined();
});

test("an agent id that is already taken is reported and built-ins survive", async () => {
  await installPlugin(
    await tempFixture((manifest) => {
      manifest.projector.contributes.agents[0].id = "projector";
    }),
  );
  onTestFinished(async () => {
    await setPluginEnabled(pluginId, false).catch(() => undefined);
    await removePlugin(pluginId).catch(() => undefined);
  });
  await trustPlugin(pluginId);

  registerBuiltinAgents();
  await ensureAgentsReady();

  const catalog = await setPluginEnabled(pluginId, true);
  const plugin = pluginFrom(catalog);
  expect(plugin.status).toBe("error");
  expect(plugin.diagnostics.some((item) => /занят/.test(item.message))).toBe(true);
  expect(listAgentBackends().some((backend) => backend.id === "projector" && backend.builtin)).toBe(
    true,
  );
});

test("the plugins API trusts and removes an installed agent plugin", async () => {
  const base = await apiServer();
  const request = (action, extra = {}) =>
    fetch(`${base}/api/plugins`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ action, ...extra }),
    });

  expect((await request("trust", { id: pluginId })).status).toBe(400);
  expect((await request("trust", { id: "@projector-tests/never-installed" })).status).toBe(400);

  const installed = await request("install", { path: await tempFixture() });
  expect(installed.status).toBe(200);

  const trusted = await request("trust", { id: pluginId });
  expect(trusted.status).toBe(200);
  const trustedCatalog = await trusted.json();
  const trustedPlugin = pluginFrom(trustedCatalog);
  expect(trustedPlugin.trusted).toBe(true);
  expect(trustedPlugin.enabled).toBe(false);

  const removed = await request("remove", { id: pluginId });
  expect(removed.status).toBe(200);
  const removedCatalog = await removed.json();
  expect(pluginFrom(removedCatalog)).toBeUndefined();
  expect(
    JSON.parse(await readFile(join(dataDir(), "plugins.json"), "utf8")).plugins[pluginId],
  ).toBe(undefined);
});
