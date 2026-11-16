import { expect, test } from "vite-plus/test";
import { pluginPackageKey } from "@ai-projector/core/modules/plugins/index.ts";
import { createApi } from "../modules/plugin-runtime/api.ts";
import { createScope } from "../modules/plugin-runtime/scope.ts";

const plugin = {
  id: "@acme/routes",
  version: "1.0.0",
  status: "enabled",
  enabled: true,
  trusted: true,
  hash: "d".repeat(64),
  languages: [],
  panels: [],
  tabs: [],
  agents: [],
  http: [
    { id: "status", path: "api/status", methods: ["GET"] },
    { id: "webhook", methods: ["POST"] },
  ],
  diagnostics: [],
};

test("api.httpUrl builds a device-aware URL under the package prefix", () => {
  const scope = createScope(plugin.id);
  const api = createApi(plugin, scope);
  const prefix = `/api/plugins/${pluginPackageKey(plugin.id)}`;

  expect(api.httpUrl("api/status")).toBe(`${prefix}/api/status`);
  expect(api.httpUrl("webhook")).toBe(`${prefix}/webhook`);
  // The server decides whether the route exists; the helper only checks the path shape.
  expect(api.httpUrl("api/missing")).toBe(`${prefix}/api/missing`);
  expect(api.httpUrl("items/:id")).toBe(`${prefix}/items/:id`);
  expect(() => api.httpUrl("../secret")).toThrow(/Некорректный/);

  scope.dispose();
  expect(() => api.httpUrl("api/status")).toThrow(/уже выключен/);
});
