import { createServer } from "node:http";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, expect, onTestFinished, test, vi } from "vite-plus/test";
import { dataDir } from "../../core/modules/app-paths/index.ts";
import { readAppearanceChoice } from "../modules/appearance/index.ts";
import {
  discoverPlugins,
  installPlugin,
  packagesDirectory,
  pluginsDirectory,
  rebuildPlugin,
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

const rebuiltId = "@projector-tests/rebuilt";

async function rebuildSource(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "projector-rebuild-test-"));
  const source = join(directory, "source");
  await mkdir(source, { recursive: true });
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({
      name: rebuiltId,
      version: "1.0.0",
      projector: {
        apiVersion: 1,
        ...(options.script === false ? {} : { build: "node build.mjs" }),
        browser: "dist/browser.mjs",
        contributes: { agents: [{ id: "rebuilt", title: "Rebuilt", command: "echo" }] },
      },
    }),
  );
  if (options.script !== false) {
    await writeFile(
      join(source, "build.mjs"),
      [
        'import { mkdirSync, writeFileSync } from "node:fs";',
        ...(options.fail ? ['console.error("build failed on purpose");', "process.exit(3);"] : []),
        'mkdirSync("dist", { recursive: true });',
        `writeFileSync("dist/browser.mjs", ${JSON.stringify(options.output ?? "export default { apiVersion: 1, activate() {} };\\n")});`,
      ].join("\n"),
    );
  }
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
  const manifestPath = join(source, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.projector.contributes.themes[0].settings = [
    { id: "paperSoftness", title: "Мягкость бумаги", kind: "blur", default: 8, min: 0, max: 30 },
  ];
  await writeFile(manifestPath, JSON.stringify(manifest));
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
    body: JSON.stringify({ choice: themeId, themeSettings: { [themeId]: { paperSoftness: 14 } } }),
  });
  expect(applied.status).toBe(200);
  expect(await readAppearanceChoice()).toBe(themeId);
  const appearance = await (await fetch(`${base}/api/appearance`)).json();
  expect(appearance.themes.map((theme) => theme.id)).toContain(themeId);

  const bootstrap = await (await fetch(`${base}/api/appearance/bootstrap.js`)).text();
  expect(bootstrap).toContain(`const choice = ${JSON.stringify(themeId)}`);
  expect(bootstrap).toContain('"--bg":"#f4ecd8"');
  expect(bootstrap).toContain('const mode = "light"');
  expect(bootstrap).toContain('"--theme-backdrop":"blur(14px)"');
  expect(bootstrap).toContain("root.style.setProperty");

  expect((await request("disable", { id: pluginId })).status).toBe(200);
  const fallback = await (await fetch(`${base}/api/appearance/bootstrap.js`)).text();
  expect(fallback).toContain('const choice = "dark"');
  expect(fallback).not.toContain("--bg");
  expect(fallback).not.toContain("--theme-backdrop");
  expect(await readAppearanceChoice()).toBe(themeId);
  const rejected = await fetch(`${base}/api/appearance`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ choice: themeId }),
  });
  expect(rejected.status).toBe(400);

  expect((await request("install", { path: source })).status).toBe(400);
});

test("rebuild builds the saved source, replaces the same version and trusts it", async () => {
  const source = await rebuildSource();
  let catalog = await rebuildPlugin({ path: source });
  expect(catalog.plugins.find((item) => item.id === rebuiltId)).toMatchObject({
    enabled: true,
    trusted: true,
    version: "1.0.0",
    source,
  });
  const installed = join(packagesDirectory(), ...rebuiltId.split("/"), "1.0.0", "dist/browser.mjs");
  expect(await readFile(installed, "utf8")).toContain("activate() {}");
  expect(
    JSON.parse(await readFile(join(dataDir(), "plugins.json"), "utf8")).plugins[rebuiltId].source,
  ).toBe(source);

  // The saved folder lets the card rebuild without asking for the path again.
  await writeFile(
    join(source, "build.mjs"),
    [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'mkdirSync("dist", { recursive: true });',
      'writeFileSync("dist/browser.mjs", "export default { rebuilt: true };\\n");',
    ].join("\n"),
  );
  catalog = await rebuildPlugin({ id: rebuiltId });
  expect(catalog.plugins.find((item) => item.id === rebuiltId)).toMatchObject({
    enabled: true,
    trusted: true,
  });
  expect(await readFile(installed, "utf8")).toContain("rebuilt: true");
});

test("plugins API rebuilds a source folder and trusts it", async () => {
  const base = await apiServer();
  const source = await rebuildSource();
  const response = await fetch(`${base}/api/plugins`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ action: "rebuild", path: source }),
  });
  expect(response.status).toBe(200);
  const catalog = await response.json();
  expect(catalog.plugins.find((item) => item.id === rebuiltId)).toMatchObject({
    enabled: true,
    trusted: true,
    source,
  });
});

test("rebuild refuses a missing build script or a failed build", async () => {
  const noScript = await rebuildSource({ script: false });
  await expect(rebuildPlugin({ path: noScript })).rejects.toThrow(/projector\.build/);
  expect((await discoverPlugins()).plugins.some((item) => item.id === rebuiltId)).toBe(false);

  const failing = await rebuildSource({ fail: true });
  await expect(rebuildPlugin({ path: failing })).rejects.toThrow(/Сборка плагина не удалась/);
  expect((await discoverPlugins()).plugins.some((item) => item.id === rebuiltId)).toBe(false);
});

test("проверка engines.projector берёт версию из манифеста, а не из кода", async () => {
  const { installedProjectorVersion } = await import("../modules/plugins/version.ts");
  const root = JSON.parse(
    await readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8"),
  );
  // Вторая копия номера в коде отставала бы от манифеста после релиза.
  expect(installedProjectorVersion()).toBe(root.version);
});

test("версия проекта читается из ближайшего манифеста, а сбой виден в логе", async () => {
  const { readProjectorVersion } = await import("../modules/plugins/version.ts");
  const directory = await mkdtemp(join(tmpdir(), "projector-version-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  // Собранная поставка: манифесты пакетов не копируются, ближайший — манифест пакета IDE.
  const server = join(directory, "packages/server/modules/plugins");
  await mkdir(server, { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ version: "9.8.7" }));
  expect(readProjectorVersion(server)).toBe("9.8.7");

  // Дерево исходников: ближайший манифест — манифест пакета сервера.
  await writeFile(join(server, "package.json"), JSON.stringify({ version: "1.0.0" }));
  expect(readProjectorVersion(server)).toBe("1.0.0");

  const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await writeFile(join(server, "package.json"), "{ broken");
    expect(readProjectorVersion(server)).toBeUndefined();
    expect(warned.mock.calls.flat().join(" ")).toMatch(/повреждён/);
    expect(warned.mock.calls.flat().join(" ")).toMatch(/engines\.projector/);
  } finally {
    warned.mockRestore();
  }
});
