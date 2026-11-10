import { createServer } from "node:http";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, expect, onTestFinished, test } from "vite-plus/test";
import { dataDir } from "../../core/modules/app-paths/index.ts";
import { readAppearanceChoice } from "../modules/appearance/index.ts";
import {
  discoverPlugins,
  installPlugin,
  pluginsDirectory,
  setPluginEnabled,
} from "../modules/plugins/index.ts";
import { handleApi } from "../app/api.ts";

const fixture = fileURLToPath(new URL("fixtures/theme-plugin", import.meta.url));
const pluginId = "@projector-tests/sepia";
const themeId = `${pluginId}/paper`;

beforeEach(async () => {
  await rm(pluginsDirectory(), { recursive: true, force: true });
  await rm(join(dataDir(), "plugins.json"), { force: true });
  await rm(join(dataDir(), "appearance.json"), { force: true });
});

async function tempFixture() {
  const directory = await mkdtemp(join(tmpdir(), "projector-plugin-test-"));
  const source = join(directory, "theme");
  await cp(fixture, source, { recursive: true });
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return source;
}

async function apiServer() {
  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("discovery isolates malformed, duplicate and unsafe packages", async () => {
  const malformed = join(pluginsDirectory(), "broken");
  await mkdir(malformed, { recursive: true });
  await writeFile(join(malformed, "package.json"), "{broken");
  let catalog = await discoverPlugins();
  expect(catalog.plugins[0].status).toBe("error");

  const source = await tempFixture();
  const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  manifest.projector.contributes.themes[0].tokens = "../../outside.json";
  await writeFile(join(source, "package.json"), JSON.stringify(manifest));
  await rm(malformed, { recursive: true, force: true });
  await cp(source, join(pluginsDirectory(), "unsafe"), { recursive: true });
  catalog = await discoverPlugins();
  expect(catalog.plugins[0].diagnostics[0].message).toMatch(/Небезопасный путь/);

  await writeFile(
    join(source, "package.json"),
    JSON.stringify({
      ...manifest,
      projector: {
        ...manifest.projector,
        contributes: {
          themes: [{ ...manifest.projector.contributes.themes[0], tokens: "themes/paper.json" }],
        },
      },
    }),
  );
  await rm(join(pluginsDirectory(), "unsafe"), { recursive: true, force: true });
  await cp(source, join(pluginsDirectory(), "first"), { recursive: true });
  await cp(source, join(pluginsDirectory(), "duplicate"), { recursive: true });
  catalog = await discoverPlugins();
  expect(catalog.plugins.filter((plugin) => plugin.id === pluginId)).toHaveLength(1);
  expect(catalog.plugins.find((plugin) => plugin.id === pluginId).status).toBe("error");
  expect(catalog.plugins.find((plugin) => plugin.id === pluginId).diagnostics[0]?.message).toMatch(
    /повторяющиеся/,
  );
});

test(
  "symlinked packages and token files are rejected",
  { skip: process.platform === "win32" },
  async () => {
    const source = await tempFixture();
    const link = join(pluginsDirectory(), "linked");
    await mkdir(pluginsDirectory(), { recursive: true });
    await symlink(source, link, "dir");
    expect((await discoverPlugins()).plugins).toEqual([]);

    await rm(link, { force: true });
    await cp(source, link, { recursive: true });
    await rm(join(link, "themes/paper.json"));
    await symlink(join(source, "themes/paper.json"), join(link, "themes/paper.json"));
    const catalog = await discoverPlugins();
    expect(catalog.plugins[0].status).toBe("error");
    expect(catalog.availableThemes).toEqual([]);
  },
);

test("enable, disable and missing states update the available catalog", async () => {
  await installPlugin(await tempFixture());
  let catalog = await discoverPlugins();
  expect(catalog.availableThemes.map((theme) => theme.id)).toEqual([themeId]);

  catalog = await setPluginEnabled(pluginId, false);
  expect(catalog.plugins[0].status).toBe("disabled");
  expect(catalog.availableThemes).toEqual([]);
  catalog = await setPluginEnabled(pluginId, true);
  expect(catalog.plugins[0].status).toBe("enabled");

  await rm(join(pluginsDirectory(), "packages/@projector-tests/sepia/1.0.0"), { recursive: true });
  catalog = await discoverPlugins();
  expect(catalog.plugins[0].status).toBe("missing");
  expect(catalog.availableThemes).toEqual([]);
});

test("plugins API installs a local fixture, applies its theme and falls back after disable", async () => {
  const base = await apiServer();
  const source = await tempFixture();
  const request = (action, extra = {}) =>
    fetch(`${base}/api/plugins`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ action, ...extra }),
    });

  const forbidden = await fetch(`${base}/api/plugins`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.invalid" },
    body: JSON.stringify({ action: "refresh" }),
  });
  expect(forbidden.status).toBe(403);

  const installed = await request("install", { path: source });
  expect(installed.status).toBe(200);
  const catalog = await installed.json();
  expect(catalog.directory).toBe(pluginsDirectory());
  expect(catalog.availableThemes[0].id).toBe(themeId);
  expect(
    JSON.parse(await readFile(join(dataDir(), "plugins.json"), "utf8")).plugins[pluginId].enabled,
  ).toBe(true);

  const applied = await fetch(`${base}/api/appearance`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ choice: themeId }),
  });
  expect(applied.status).toBe(200);
  expect(await readAppearanceChoice()).toBe(themeId);
  const appearance = await (await fetch(`${base}/api/appearance`)).json();
  expect(appearance.themes.map((theme) => theme.id)).toContain(themeId);

  const bootstrap = await (await fetch(`${base}/api/appearance/bootstrap.js`)).text();
  expect(bootstrap).toContain(`const choice = ${JSON.stringify(themeId)}`);
  expect(bootstrap).toContain('"--bg":"#f4ecd8"');
  expect(bootstrap).toContain('const mode = "light"');
  expect(bootstrap).toContain("root.style.setProperty");

  expect((await request("disable", { id: pluginId })).status).toBe(200);
  const fallback = await (await fetch(`${base}/api/appearance/bootstrap.js`)).text();
  expect(fallback).toContain('const choice = "dark"');
  expect(fallback).not.toContain("--bg");
  expect(await readAppearanceChoice()).toBe(themeId);
  const rejected = await fetch(`${base}/api/appearance`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ choice: themeId }),
  });
  expect(rejected.status).toBe(400);

  expect((await request("install", { path: source })).status).toBe(400);
});
