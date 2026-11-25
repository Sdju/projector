import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, onTestFinished, test, expect } from "vite-plus/test";
import { dataDir } from "../../core/modules/app-paths/index.ts";
import { projectPluginId } from "../../core/modules/plugins/index.ts";
import { listAgentBackends } from "../modules/agent/index.ts";
import {
  clearProjectPluginCode,
  discoverProjectPlugins,
  projectPluginCacheDirectory,
  projectPluginStateFile,
  setProjectPluginEnabled,
  setProjectPluginTrust,
} from "../modules/project-plugins/index.ts";
import { pluginRouteUrl, registeredPluginRouteIds } from "../modules/plugin-routes/index.ts";
import { handleApi } from "../app/api.ts";

const previousDataHome = process.env.XDG_DATA_HOME;
let dataHome = "";

beforeAll(async () => {
  dataHome = await mkdtemp(join(tmpdir(), "projector-project-plugin-data-"));
  process.env.XDG_DATA_HOME = dataHome;
});

afterAll(async () => {
  await rm(dataHome, { recursive: true, force: true });
  if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previousDataHome;
});

async function projectFixture() {
  const directory = await mkdtemp(join(tmpdir(), "projector-project-plugin-"));
  const root = join(directory, "repo");
  const packageRoot = join(root, ".projector", "plugins", "board");
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@tests/project-board",
      version: "1.0.0",
      projector: {
        apiVersion: 1,
        browser: "dist/browser.mjs",
        server: "dist/server.cjs",
        contributes: {
          agents: [{ id: "board-helper", title: "Board Helper" }],
          http: [{ id: "ping", path: "ping" }],
        },
      },
    }),
  );
  await writeFile(
    join(packageRoot, "dist", "browser.mjs"),
    "export default { apiVersion: 1, activate() {} };\n",
  );
  await writeFile(
    join(packageRoot, "dist", "server.cjs"),
    [
      "exports.createPlugin = (api) => {",
      '  api.http.register({ id: "ping", handle: (context) => context.json(200, { ok: true }) });',
      '  return { agents: [{ id: "board-helper", label: "Board Helper", run: async () => {} }] };',
      "};",
    ].join("\n"),
  );
  const projectId = `project-plugin-test-${Date.now()}`;
  await mkdir(dirname(join(dataDir(), "projects.json")), { recursive: true });
  await writeFile(
    join(dataDir(), "projects.json"),
    JSON.stringify({
      projects: [
        {
          id: projectId,
          name: "Project plugin test",
          path: root,
          url: "",
          icon: "",
          mode: "server",
          defaultCommandId: "",
          commands: [],
          createdAt: new Date().toISOString(),
        },
      ],
    }),
  );
  onTestFinished(() => {
    clearProjectPluginCode(projectId);
    return Promise.all([
      rm(directory, { recursive: true, force: true }),
      rm(projectPluginCacheDirectory(), { recursive: true, force: true }),
      rm(projectPluginStateFile(), { force: true }),
      rm(join(dataDir(), "projects.json"), { force: true }),
    ]);
  });
  return { root, packageRoot, projectId };
}

test("a project plugin stays inert until its exact content is trusted", async () => {
  const { packageRoot, projectId } = await projectFixture();
  const scoped = projectPluginId(projectId, "@tests/project-board");
  const first = await discoverProjectPlugins(projectId);
  expect(first.plugins).toHaveLength(1);
  expect(first.plugins[0].id).toBe(scoped);
  expect(first.plugins[0].enabled).toBe(false);
  expect(first.plugins[0].trusted).toBe(false);
  expect(first.plugins[0].requiresTrust).toBe(true);
  expect(first.plugins[0].path).toBe(packageRoot);
  expect(listAgentBackends(projectId).some((agent) => agent.projectId === projectId)).toBe(false);

  await setProjectPluginTrust(projectId, "@tests/project-board", true);
  const trusted = await discoverProjectPlugins(projectId);
  expect(trusted.plugins[0].trusted).toBe(true);
  expect(trusted.plugins[0].enabled).toBe(true);
  expect(trusted.plugins[0].status).toBe("enabled");
  expect(trusted.plugins[0].path).not.toBe(packageRoot);
  expect(trusted.plugins[0].path).toContain("projects");
  expect(registeredPluginRouteIds(scoped).has("ping")).toBe(true);
  const agents = listAgentBackends(projectId);
  expect(agents.some((agent) => agent.id === projectPluginId(projectId, "board-helper"))).toBe(
    true,
  );
  // Another project's menu must not see this agent.
  expect(listAgentBackends("another-project").some((agent) => agent.projectId === projectId)).toBe(
    false,
  );

  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}${pluginRouteUrl(scoped, "ping")}`, {
    headers: { Origin: base },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });

  const plugin = trusted.plugins[0];
  const asset = await fetch(
    `${base}/api/plugins/assets/${plugin.browser.key}/${plugin.hash}/browser.mjs`,
    { headers: { Origin: base } },
  );
  expect(asset.status).toBe(200);
  expect(asset.headers.get("content-type")).toContain("text/javascript");

  await writeFile(
    join(packageRoot, "dist", "browser.mjs"),
    "export default { apiVersion: 1, activate() { throw new Error('changed'); } };\n",
  );
  const changed = await discoverProjectPlugins(projectId);
  expect(changed.plugins[0].trusted).toBe(false);
  expect(changed.plugins[0].status).toBe("error");
  expect(changed.plugins[0].diagnostics[0].message).toContain("изменилось");
  expect(registeredPluginRouteIds(scoped).size).toBe(0);

  await setProjectPluginEnabled(projectId, "@tests/project-board", false);
  const disabled = await discoverProjectPlugins(projectId);
  expect(disabled.plugins[0].enabled).toBe(false);
  expect(disabled.plugins[0].status).toBe("disabled");
  await expect(setProjectPluginEnabled(projectId, "@tests/project-board", true)).rejects.toThrow(
    "доверие",
  );
});
