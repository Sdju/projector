import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, expect, onTestFinished, test } from "vite-plus/test";
import { dataDir } from "../../core/modules/app-paths/index.ts";
import { loadCodeAgents } from "../modules/agents/plugin/index.ts";
import { copyPackage } from "../modules/plugins/install.ts";
import {
  installPlugin,
  pluginsDirectory,
  removePlugin,
  trustPlugin,
} from "../modules/plugins/index.ts";

const pluginId = "@projector-tests/plugin-deps";
const depName = "@projector-tests/local-dep";
const hostPackage = "vite-plus";
const hostRequire = createRequire(fileURLToPath(import.meta.url));

beforeEach(async () => {
  await rm(pluginsDirectory(), { recursive: true, force: true });
  await rm(join(dataDir(), "plugins.json"), { force: true });
});

async function writeDep(root) {
  const directory = join(root, "node_modules", "@projector-tests", "local-dep");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: depName, version: "1.0.0", main: "index.js" }),
  );
  await writeFile(join(directory, "index.js"), 'module.exports = { ok: "plugin-dep" };\n');
}

async function writePlugin(root, { withDeps = true } = {}) {
  await mkdir(root, { recursive: true });
  const agent = { id: "dep-agent", title: "Dep Agent" };
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: pluginId,
      version: "1.0.0",
      ...(withDeps ? { dependencies: { [depName]: "1.0.0" } } : {}),
      projector: {
        apiVersion: 1,
        server: "server.cjs",
        contributes: { agents: [agent] },
      },
    }),
  );
  await writeFile(
    join(root, "server.cjs"),
    `exports.createAgents = (api) => {
  const viaApi = api.require(${JSON.stringify(depName)});
  const viaNative = require(${JSON.stringify(depName)});
  let host = "missing";
  try {
    api.require(${JSON.stringify(hostPackage)});
    host = "resolved";
  } catch {
    host = "missing";
  }
  return [{
    id: "dep-agent",
    label: "Dep Agent",
    run: async () => {},
    probe: { viaApi: viaApi.ok, viaNative: viaNative.ok, host },
  }];
};
`,
  );
}

function pluginFrom(catalog) {
  return catalog.plugins.find((plugin) => plugin.id === pluginId);
}

test("bundled node_modules without symlinks install, trust and resolve from the plugin", async () => {
  expect(() => hostRequire.resolve(hostPackage)).not.toThrow();
  const source = await mkdtemp(join(tmpdir(), "projector-plugin-deps-bundled-"));
  onTestFinished(() => rm(source, { recursive: true, force: true }));
  await writePlugin(source);
  await writeDep(source);

  const installed = await installPlugin(source);
  const plugin = pluginFrom(installed);
  expect(plugin.dependencies).toEqual({ [depName]: "1.0.0" });
  expect(plugin.trusted).toBe(false);
  onTestFinished(() => removePlugin(pluginId).catch(() => undefined));

  const trusted = await trustPlugin(pluginId);
  const trustedPlugin = pluginFrom(trusted);
  expect(trustedPlugin.trusted).toBe(true);
  const stamp = JSON.parse(
    await readFile(join(trustedPlugin.path, "node_modules", ".projector-deps.json"), "utf8"),
  );
  expect(stamp).toEqual({
    dependencies: { [depName]: "1.0.0" },
    optionalDependencies: {},
  });

  const backends = await loadCodeAgents(trustedPlugin.server, trustedPlugin.hash);
  expect(backends).toHaveLength(1);
  expect(backends[0].probe).toEqual({
    viaApi: "plugin-dep",
    viaNative: "plugin-dep",
    host: "missing",
  });
});

test(
  "copyPackage skips a symlinked node_modules and trust rejects missing deps offline",
  { skip: process.platform === "win32" },
  async () => {
    const source = await mkdtemp(join(tmpdir(), "projector-plugin-deps-linked-"));
    onTestFinished(() => rm(source, { recursive: true, force: true }));
    await writePlugin(source);
    await mkdir(join(source, "node_modules", "real-dep"), { recursive: true });
    await writeFile(join(source, "node_modules", "real-dep", "index.js"), "module.exports = 1;\n");
    await symlink(
      join(source, "node_modules", "real-dep"),
      join(source, "node_modules", "@projector-tests"),
    );

    const parent = await mkdtemp(join(tmpdir(), "projector-plugin-deps-copy-"));
    onTestFinished(() => rm(parent, { recursive: true, force: true }));
    const copied = join(parent, "pkg");
    await copyPackage(source, copied);
    await expect(
      readFile(join(copied, "node_modules", "real-dep", "index.js"), "utf8"),
    ).rejects.toThrow();
    expect(JSON.parse(await readFile(join(copied, "package.json"), "utf8")).name).toBe(pluginId);

    const catalog = await installPlugin(source);
    const plugin = pluginFrom(catalog);
    expect(plugin).toBeTruthy();
    onTestFinished(() => removePlugin(pluginId).catch(() => undefined));
    await expect(
      readFile(join(plugin.path, "node_modules", "real-dep", "index.js"), "utf8"),
    ).rejects.toThrow();

    const previousOffline = process.env.npm_config_offline;
    process.env.npm_config_offline = "true";
    try {
      await expect(trustPlugin(pluginId)).rejects.toThrow(
        /Не удалось установить зависимости плагина/,
      );
    } finally {
      if (previousOffline === undefined) delete process.env.npm_config_offline;
      else process.env.npm_config_offline = previousOffline;
    }
  },
);

test("trustPlugin rejects a server plugin whose node_modules is absent when offline", async () => {
  const source = await mkdtemp(join(tmpdir(), "projector-plugin-deps-missing-"));
  onTestFinished(() => rm(source, { recursive: true, force: true }));
  await writePlugin(source);

  await installPlugin(source);
  onTestFinished(() => removePlugin(pluginId).catch(() => undefined));
  const previousOffline = process.env.npm_config_offline;
  process.env.npm_config_offline = "true";
  try {
    await expect(trustPlugin(pluginId)).rejects.toThrow(
      /Не удалось установить зависимости плагина/,
    );
  } finally {
    if (previousOffline === undefined) delete process.env.npm_config_offline;
    else process.env.npm_config_offline = previousOffline;
  }
});
