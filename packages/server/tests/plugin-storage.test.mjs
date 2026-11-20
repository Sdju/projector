import { createServer } from "node:http";
import { once } from "node:events";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, expect, onTestFinished, test } from "vite-plus/test";
import {
  parsePluginStorage,
  pluginPackageKey,
  pluginStorageKey,
  serializePluginStorageValue,
} from "../../core/modules/plugins/index.ts";
import { dataDir } from "../../core/modules/app-paths/index.ts";
import {
  PluginStorageLimitError,
  PluginStoragePathError,
  deletePluginStorageValue,
  discoverPlugins,
  installPlugin,
  pluginStorageDirectory,
  pluginStorageFile,
  pluginsDataDirectory,
  pluginsDirectory,
  readPluginStorage,
  removePlugin,
  setPluginEnabled,
  writePluginStorageValue,
} from "../modules/plugins/index.ts";
import { handleApi } from "../app/api.ts";

const fixture = fileURLToPath(new URL("fixtures/theme-plugin", import.meta.url));
const pluginId = "@projector-tests/sepia";
const key = pluginPackageKey(pluginId);

let directory;
const previous = process.env.XDG_DATA_HOME;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "projector-plugin-storage-"));
  process.env.XDG_DATA_HOME = directory;
  await rm(pluginsDirectory(), { recursive: true, force: true });
  await rm(join(dataDir(), "plugins.json"), { force: true });
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
});

beforeEach(async () => {
  await rm(pluginsDirectory(), { recursive: true, force: true });
  await rm(join(dataDir(), "plugins.json"), { force: true });
});

async function installed() {
  const directory = await mkdtemp(join(tmpdir(), "projector-plugin-storage-source-"));
  const source = join(directory, "sepia");
  await cp(fixture, source, { recursive: true });
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return installPlugin(source);
}

async function apiServer() {
  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("ключ и значение подчиняются одним правилам на клиенте и сервере", () => {
  expect(pluginStorageKey("theme")).toBe("theme");
  expect(() => pluginStorageKey("")).toThrow(/1 до/);
  expect(() => pluginStorageKey("a".repeat(201))).toThrow(/1 до/);
  expect(() => pluginStorageKey("__proto__")).toThrow(/зарезервирован/);
  expect(() => pluginStorageKey("a\nb")).toThrow(/управляющих/);
  expect(() => pluginStorageKey(42)).toThrow(/строкой/);

  expect(serializePluginStorageValue({ theme: "paper" })).toBe('{"theme":"paper"}');
  expect(() => serializePluginStorageValue(undefined)).toThrow(/сериализуемым/);
  const circular = {};
  circular.self = circular;
  expect(() => serializePluginStorageValue(circular)).toThrow(/сериализуемым/);

  expect(parsePluginStorage('{"version":1,"data":{"a":1}}')).toEqual({ a: 1 });
  expect(parsePluginStorage('{"version":2,"data":{}}')).toBeNull();
  expect(parsePluginStorage('{"version":1,"data":[]}')).toBeNull();
  expect(parsePluginStorage("not json")).toBeNull();
  expect(parsePluginStorage('{"version":1,"data":{"__proto__":{"polluted":true}}}')).toEqual({});
});

test("запись переживает конкурентные изменения и не выходит за квоту", async () => {
  await installed();
  const file = pluginStorageFile(pluginId);
  expect(file.startsWith(pluginStorageDirectory(pluginId))).toBe(true);
  expect(pluginStorageDirectory(pluginId).replaceAll("\\", "/")).toContain(`/data/${key}`);

  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      writePluginStorageValue(pluginId, `key${index}`, { index }),
    ),
  );
  const data = await readPluginStorage(pluginId);
  expect(Object.keys(data)).toHaveLength(20);
  expect(data.key7).toEqual({ index: 7 });

  // The state file is private: it may hold tokens or other plugin secrets.
  if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);

  await writePluginStorageValue(pluginId, "keep", "value");
  await expect(writePluginStorageValue(pluginId, "huge", "x".repeat(1_000_000))).rejects.toThrow(
    PluginStorageLimitError,
  );
  expect(await readPluginStorage(pluginId)).toMatchObject({ keep: "value" });

  await deletePluginStorageValue(pluginId, "keep");
  expect(await readPluginStorage(pluginId)).not.toHaveProperty("keep");
});

test("повреждённый файл откладывается, а не затирается", async () => {
  await installed();
  const file = pluginStorageFile(pluginId);
  await mkdir(pluginStorageDirectory(pluginId), { recursive: true });
  await writeFile(file, "{broken");

  expect(await readPluginStorage(pluginId)).toEqual({});
  const backup = (await readdir(pluginStorageDirectory(pluginId))).find((name) =>
    name.startsWith("state.json.broken-"),
  );
  expect(backup).toBeTruthy();
  expect(await readFile(join(pluginStorageDirectory(pluginId), backup), "utf8")).toBe("{broken");
});

test("повреждённый plugins.json откладывается, а не затирается", async () => {
  await mkdir(dataDir(), { recursive: true });
  const file = join(dataDir(), "plugins.json");
  await writeFile(file, "{broken");

  expect((await discoverPlugins()).plugins).toEqual([]);
  await expect(lstat(file)).rejects.toMatchObject({ code: "ENOENT" });
  const backup = (await readdir(dataDir())).find((name) => name.startsWith("plugins.json.broken-"));
  expect(backup).toBeTruthy();
  expect(await readFile(join(dataDir(), backup), "utf8")).toBe("{broken");
});

test(
  "символическая ссылка вместо каталога данных отклоняется",
  { skip: process.platform === "win32" },
  async () => {
    await installed();
    const outside = await mkdtemp(join(tmpdir(), "projector-plugin-storage-outside-"));
    onTestFinished(() => rm(outside, { recursive: true, force: true }));
    await mkdir(join(pluginsDirectory(), "data"), { recursive: true });
    await rm(pluginStorageDirectory(pluginId), { recursive: true, force: true });
    await symlink(outside, pluginStorageDirectory(pluginId), "dir");

    await expect(readPluginStorage(pluginId)).rejects.toThrow(PluginStoragePathError);
  },
);

test("данные сохраняются при выключении и удаляются вместе с установкой", async () => {
  await installed();
  await writePluginStorageValue(pluginId, "theme", "paper");
  await setPluginEnabled(pluginId, false);
  expect(await readPluginStorage(pluginId)).toEqual({ theme: "paper" });

  await removePlugin(pluginId);
  await expect(readPluginStorage(pluginId)).resolves.toEqual({});
  expect(await readdir(pluginStorageDirectory(pluginId)).catch(() => [])).toEqual([]);
});

test("маршрут хранилища доступен только странице Projector и соблюдает лимиты", async () => {
  await installed();
  const base = await apiServer();
  const url = `${base}/api/plugins/${key}/storage`;
  const origin = { "Content-Type": "application/json", Origin: base };

  const empty = await fetch(url);
  expect(empty.status).toBe(200);
  expect(await empty.json()).toEqual({ data: {} });
  // A read must not create the package folder: only a write does.
  await expect(lstat(pluginsDataDirectory())).rejects.toMatchObject({ code: "ENOENT" });

  const forbidden = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.invalid" },
    body: JSON.stringify({ key: "theme", value: "paper" }),
  });
  expect(forbidden.status).toBe(403);

  const saved = await fetch(url, {
    method: "PUT",
    headers: origin,
    body: JSON.stringify({ key: "theme", value: "paper" }),
  });
  expect(saved.status).toBe(200);
  expect(await (await fetch(url)).json()).toEqual({ data: { theme: "paper" } });

  const missingValue = await fetch(url, {
    method: "PUT",
    headers: origin,
    body: JSON.stringify({ key: "theme" }),
  });
  expect(missingValue.status).toBe(400);

  const badKey = await fetch(url, {
    method: "PUT",
    headers: origin,
    body: JSON.stringify({ key: "__proto__", value: 1 }),
  });
  expect(badKey.status).toBe(400);

  expect(
    (
      await fetch(url, {
        method: "PUT",
        headers: origin,
        body: JSON.stringify({ key: "large", value: "x".repeat(700_000) }),
      })
    ).status,
  ).toBe(200);
  const overQuota = await fetch(url, {
    method: "PUT",
    headers: origin,
    body: JSON.stringify({ key: "large2", value: "x".repeat(700_000) }),
  });
  expect(overQuota.status).toBe(413);

  const removed = await fetch(`${url}?key=theme`, { method: "DELETE", headers: origin });
  expect(removed.status).toBe(200);
  expect((await (await fetch(url)).json()).data).not.toHaveProperty("theme");

  expect((await fetch(`${url}?key=`, { method: "DELETE", headers: origin })).status).toBe(400);
  expect((await fetch(url, { method: "PATCH", headers: origin })).status).toBe(405);
  expect(
    (await fetch(`${base}/api/plugins/${pluginPackageKey("@unknown/plugin")}/storage`)).status,
  ).toBe(404);
});
