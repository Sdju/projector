import { afterEach, expect, test } from "vite-plus/test";
import { pluginPackageKey } from "@ai-projector/core/modules/plugins/index.ts";
import { createApi } from "../modules/plugin-runtime/api.ts";
import { createScope } from "../modules/plugin-runtime/scope.ts";

const hash = "b".repeat(64);
const plugin = {
  id: "@acme/storage",
  version: "1.0.0",
  status: "enabled",
  enabled: true,
  trusted: true,
  hash,
  languages: [],
  panels: [],
  tabs: [],
  agents: [],
  diagnostics: [],
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function fakeStorage() {
  const store = new Map();
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body });
    if (method === "PUT") {
      const body = JSON.parse(init.body);
      store.set(body.key, body.value);
      return Response.json({ ok: true });
    }
    if (method === "DELETE") {
      store.delete(new URL(url, "http://localhost").searchParams.get("key"));
      return Response.json({ ok: true });
    }
    return Response.json({ data: Object.fromEntries(store) });
  };
  return { store, calls };
}

test("api.storage reads, writes and deletes package-scoped values", async () => {
  const { store, calls } = fakeStorage();
  const scope = createScope(plugin.id);
  const api = createApi(plugin, scope);

  expect(await api.storage.keys()).toEqual([]);
  await api.storage.set("theme", { name: "paper", contrast: 2 });
  await api.storage.set("mascot", "whale");
  expect(store.get("theme")).toEqual({ name: "paper", contrast: 2 });
  expect(await api.storage.get("theme")).toEqual({ name: "paper", contrast: 2 });
  expect((await api.storage.keys()).sort()).toEqual(["mascot", "theme"]);

  await api.storage.delete("mascot");
  expect(await api.storage.get("mascot")).toBeUndefined();
  expect((await api.storage.keys()).sort()).toEqual(["theme"]);

  const url = `/api/plugins/${pluginPackageKey(plugin.id)}/storage`;
  expect(calls[0].url).toBe(url);
  expect(calls.find((call) => call.method === "PUT").url).toBe(url);
  expect(calls.find((call) => call.method === "DELETE").url).toBe(`${url}?key=mascot`);
  scope.dispose();
});

test("api.storage rejects bad keys, oversized values and a disposed scope", async () => {
  const { store } = fakeStorage();
  const scope = createScope(plugin.id);
  const api = createApi(plugin, scope);

  await expect(api.storage.set("", 1)).rejects.toThrow(/от 1 до/);
  await expect(api.storage.set("__proto__", 1)).rejects.toThrow(/зарезервирован/);
  await expect(api.storage.set("big", "x".repeat(1_000_000))).rejects.toThrow(/не помещается/);
  expect(store.size).toBe(0);

  scope.dispose();
  await expect(api.storage.keys()).rejects.toThrow(/уже выключен/);
});

test("api.storage surfaces the server error message", async () => {
  globalThis.fetch = async () =>
    Response.json({ error: "Хранилище плагина недоступно" }, { status: 409 });
  const scope = createScope(plugin.id);
  const api = createApi(plugin, scope);
  await expect(api.storage.get("theme")).rejects.toThrow("Хранилище плагина недоступно");
  scope.dispose();
});
