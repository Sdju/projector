import { createServer } from "node:http";
import { once } from "node:events";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, expect, onTestFinished, test } from "vite-plus/test";
import { dataDir } from "../../core/modules/app-paths/index.ts";
import { pluginPackageKey } from "../../core/modules/plugins/index.ts";
import { registerBuiltinAgents } from "../app/agents.ts";
import { handleApi } from "../app/api.ts";
import { clearPluginRoutes } from "../modules/plugin-routes/index.ts";
import {
  installPlugin,
  pluginsDirectory,
  setPluginEnabled,
  trustPlugin,
} from "../modules/plugins/index.ts";

const fixture = fileURLToPath(new URL("fixtures/http-plugin", import.meta.url));
const brokenFixture = fileURLToPath(new URL("fixtures/http-plugin-missing", import.meta.url));
const pluginId = "@projector-tests/http-plugin";
const brokenId = "@projector-tests/http-plugin-missing";
const key = pluginPackageKey(pluginId);

let directory;
const previous = process.env.XDG_DATA_HOME;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "projector-plugin-http-"));
  process.env.XDG_DATA_HOME = directory;
  registerBuiltinAgents();
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
});

beforeEach(async () => {
  clearPluginRoutes();
  await rm(pluginsDirectory(), { recursive: true, force: true });
  await rm(join(dataDir(), "plugins.json"), { force: true });
});

async function tempFixture(source = fixture) {
  const root = await mkdtemp(join(tmpdir(), "projector-plugin-http-source-"));
  const target = join(root, "plugin");
  await cp(source, target, { recursive: true });
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return target;
}

async function installed(source = fixture) {
  const path = await tempFixture(source);
  await installPlugin(path);
  await trustPlugin(pluginId);
  await setPluginEnabled(pluginId, true);
}

async function apiServer() {
  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("маршруты плагина живут по объявленному пути и снимаются при выключении", async () => {
  await installed();
  const base = await apiServer();
  const url = `${base}/api/plugins/${key}`;
  const origin = { "Content-Type": "application/json", Origin: base };

  const status = await fetch(`${url}/status`);
  expect(status.status).toBe(200);
  expect(await status.json()).toEqual({ ok: true, method: "GET" });

  // HEAD is served by a GET route without a body.
  expect((await fetch(`${url}/status`, { method: "HEAD" })).status).toBe(200);

  const echo = await fetch(`${url}/api/echo`, {
    method: "POST",
    headers: origin,
    body: JSON.stringify({ hello: "world" }),
  });
  expect(echo.status).toBe(200);
  expect(await echo.json()).toEqual({ hello: "world" });

  const wrongMethod = await fetch(`${url}/api/echo`, {
    method: "PUT",
    headers: origin,
    body: "{}",
  });
  expect(wrongMethod.status).toBe(405);
  expect(wrongMethod.headers.get("allow")).toBe("POST");

  // Static segments win over params, but a method mismatch falls through to the param route.
  const me = await fetch(`${url}/items/me`);
  expect(await me.json()).toEqual({ me: true });
  const item = await fetch(`${url}/items/42`, {
    method: "POST",
    headers: origin,
    body: "{}",
  });
  expect(await item.json()).toEqual({ item: "42" });
  const mePost = await fetch(`${url}/items/me`, {
    method: "POST",
    headers: origin,
    body: "{}",
  });
  expect(await mePost.json()).toEqual({ item: "me" });
  const wildcard = await fetch(`${url}/files/a/b.txt`);
  expect(await wildcard.json()).toEqual({ file: "a/b.txt" });

  const foreign = await fetch(`${url}/api/echo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.invalid" },
    body: "{}",
  });
  expect(foreign.status).toBe(403);

  // A mutation must carry Origin even when the base access check allows a missing one.
  const noOrigin = await fetch(`${url}/api/echo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  expect(noOrigin.status).toBe(403);

  // A `local` route opts out of the Origin requirement for local services and webhooks, but the
  // base loopback/LAN check and a mismatched Origin still apply.
  const local = await fetch(`${url}/local/echo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service: true }),
  });
  expect(local.status).toBe(200);
  expect(await local.json()).toEqual({ local: { service: true } });
  const localForeign = await fetch(`${url}/local/echo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.invalid" },
    body: "{}",
  });
  expect(localForeign.status).toBe(403);

  const oversized = await fetch(`${url}/limited`, {
    method: "POST",
    headers: origin,
    body: "x".repeat(32),
  });
  expect(oversized.status).toBe(413);

  expect((await fetch(`${url}/missing`)).status).toBe(404);

  await setPluginEnabled(pluginId, false);
  expect((await fetch(`${url}/status`)).status).toBe(404);

  await setPluginEnabled(pluginId, true);
  expect((await fetch(`${url}/status`)).status).toBe(200);
});

test("плагин с незарегистрированным маршрутом попадает в ошибки каталога", async () => {
  const path = await tempFixture(brokenFixture);
  await installPlugin(path);
  await trustPlugin(brokenId);
  const catalog = await setPluginEnabled(brokenId, true);
  const plugin = catalog.plugins.find((item) => item.id === brokenId);
  expect(plugin?.status).toBe("error");
  expect(plugin?.diagnostics.map((item) => item.message).join(" ")).toMatch(
    /не зарегистрировал маршруты: status/,
  );
});
