import { createServer } from "node:http";
import { once } from "node:events";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, expect, onTestFinished, test, vi } from "vite-plus/test";
import { dataDir } from "../../core/modules/app-paths/index.ts";
import {
  discoverPlugins,
  installPlugin,
  pluginsDirectory,
  setPluginEnabled,
  trustPlugin,
  watchPluginDirectory,
} from "../modules/plugins/index.ts";
import { readTrustNotices, trustNoticeFile } from "../modules/trust-notices/index.ts";
import { handleApi } from "../app/api.ts";

const fixture = fileURLToPath(new URL("fixtures/agent-plugin", import.meta.url));
const pluginId = "@projector-tests/agent-plugin";

beforeEach(async () => {
  await rm(pluginsDirectory(), { recursive: true, force: true });
  await rm(join(dataDir(), "plugins.json"), { force: true });
  await rm(trustNoticeFile(), { force: true });
});

async function installedPlugin() {
  const directory = await mkdtemp(join(tmpdir(), "projector-plugin-notice-test-"));
  const source = join(directory, "agent");
  await cp(fixture, source, { recursive: true });
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const catalog = await installPlugin(source);
  const plugin = catalog.plugins.find((item) => item.id === pluginId);
  if (!plugin?.path) throw new Error("Плагин не установился");
  await trustPlugin(pluginId);
  await setPluginEnabled(pluginId, true);
  return plugin.path;
}

test("a changed trusted package produces one inbox notice until trust is restored", async () => {
  const path = await installedPlugin();
  expect(await readTrustNotices()).toEqual([]);

  await writeFile(join(path, "changed.txt"), "new content\n");
  await discoverPlugins();

  const notices = await readTrustNotices();
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({
    id: `plugin-trust:${pluginId}`,
    plugin: pluginId,
    name: "Fixture ACP",
    href: "/settings?section=plugins",
  });
  expect(notices[0].title).toMatch(/Доверие к плагину «Fixture ACP» отозвано/);

  // Discovery is idempotent: the same changed package is still one notice.
  await discoverPlugins();
  expect(await readTrustNotices()).toHaveLength(1);

  await trustPlugin(pluginId);
  expect(await readTrustNotices()).toEqual([]);

  // A disabled plugin no longer needs the user's attention, even if its files differ.
  await writeFile(join(path, "changed-again.txt"), "new content\n");
  await discoverPlugins();
  expect(await readTrustNotices()).toHaveLength(1);
  await setPluginEnabled(pluginId, false);
  expect(await readTrustNotices()).toEqual([]);
});

test("the notices API returns the pending list without an origin header", async () => {
  const path = await installedPlugin();
  await writeFile(join(path, "changed.txt"), "new content\n");
  await discoverPlugins();

  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => new Promise((resolve) => server.close(resolve)));

  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/trust-notices`);
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.notices).toHaveLength(1);
  expect(data.notices[0].plugin).toBe(pluginId);

  const restored = await fetch(`${origin}/api/trust-notices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ id: data.notices[0].id }),
  });
  expect(restored.status).toBe(200);
  expect((await restored.json()).notices).toEqual([]);
  const plugin = (await discoverPlugins()).plugins.find((item) => item.id === pluginId);
  expect(plugin?.trusted).toBe(true);
  expect(plugin?.enabled).toBe(true);
});

test("the plugin watcher re-reads the catalog after a package file changes", async () => {
  const path = await installedPlugin();
  const stop = watchPluginDirectory(pluginsDirectory, discoverPlugins);
  onTestFinished(stop);
  await writeFile(join(path, "changed.txt"), "watched content\n");
  await vi.waitFor(async () => expect(await readTrustNotices()).toHaveLength(1), {
    timeout: 5000,
  });
});
