import { expect, test } from "vite-plus/test";
import { createTabRegistry, defineTab, singletonTab } from "../src/modules/workspace-api/tabs.ts";
import { ensureTab } from "../src/modules/workspace/lib/service-tabs.ts";
import { baseTabTypes } from "../src/modules/workspace/lib/virtual-tabs.ts";
import { workspaceSessionSchema } from "../src/modules/workspace/session.ts";

const issue = defineTab({
  id: "issue",
  key: ({ number }) => `issue:${number}`,
  path: ({ number }) => `Issue #${number}`,
  title: ({ number }) => `Issue #${number}`,
  hint: ({ title }) => title ?? "",
});

test("application settings reuse one tab and restore through the workspace session", () => {
  const registry = createTabRegistry(baseTabTypes);
  const tabs = { value: [] };
  const key = ensureTab(tabs, registry, "settings");
  expect(key).toBe("settings:app");
  expect(ensureTab(tabs, registry, "settings")).toBe(key);
  expect(tabs.value.length).toBe(1);
  expect(tabs.value[0].preview).toBe(false);
  expect(registry.get("settings").command.id).toBe("ide.workbench.settings.open");
  expect(registry.get("settings").command.description).toMatch(/существующую вкладку/);
  const saved = workspaceSessionSchema.parse({
    tabs: tabs.value,
    activeKey: key,
    section: "files",
  });
  const restored = { value: [] };
  for (const tab of saved.tabs) ensureTab(restored, registry, tab.virtual, tab.params);
  expect(restored.value[0].key).toBe(saved.activeKey);
  expect(restored.value[0].virtual).toBe("settings");
});

test("later groups replace base kinds and unknown kinds are not opened", () => {
  const base = singletonTab("network", "network:info", "Сеть", "Сеть");
  const registry = createTabRegistry([base], [issue, { ...base, path: () => "Другая" }]);
  expect(registry.get("network").path({})).toBe("Другая");
  expect(registry.keyOf("network")).toBe("network:info");
  expect(() => registry.keyOf("agent")).toThrow();
  const tabs = { value: [] };
  expect(ensureTab(tabs, registry, "agent")).toBe(undefined);
  expect(tabs.value.length).toBe(0);
});

test("ensureTab keys a tab by its params and reuses an open one", () => {
  const registry = createTabRegistry([issue]);
  const tabs = { value: [] };
  expect(ensureTab(tabs, registry, "issue", { number: 7, title: "Bug" })).toBe("issue:7");
  expect(ensureTab(tabs, registry, "issue", { number: 7 })).toBe("issue:7");
  expect(ensureTab(tabs, registry, "issue", { number: 8 })).toBe("issue:8");
  expect(tabs.value.map((tab) => [tab.key, tab.virtual, tab.path, tab.content])).toStrictEqual([
    ["issue:7", "issue", "Issue #7", "Bug"],
    ["issue:8", "issue", "Issue #8", ""],
  ]);
});

test("a preview kind opens as a preview unless pinned and a pinned tab stays pinned", () => {
  const registry = createTabRegistry([{ ...issue, preview: true }]);
  const tabs = { value: [] };
  ensureTab(tabs, registry, "issue", { number: 1 }, true);
  expect(tabs.value[0].preview).toBe(true);
  ensureTab(tabs, registry, "issue", { number: 1 }, false);
  expect(tabs.value[0].preview).toBe(false);
  ensureTab(tabs, registry, "issue", { number: 1 }, true);
  expect(tabs.value[0].preview).toBe(false);
  ensureTab(tabs, registry, "issue", { number: 2 });
  expect(tabs.value[1].preview).toBe(false);
});

test("a kind that is not a preview kind never opens as a preview", () => {
  const registry = createTabRegistry([issue]);
  const tabs = { value: [] };
  ensureTab(tabs, registry, "issue", { number: 3 }, true);
  expect(tabs.value[0].preview).toBe(false);
});
