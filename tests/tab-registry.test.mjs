import assert from "node:assert/strict";
import { test } from "node:test";
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
  assert.equal(key, "settings:app");
  assert.equal(ensureTab(tabs, registry, "settings"), key);
  assert.equal(tabs.value.length, 1);
  assert.equal(tabs.value[0].preview, false);
  assert.equal(registry.get("settings").command.id, "ide.workbench.settings.open");
  assert.match(registry.get("settings").command.description, /существующую вкладку/);
  const saved = workspaceSessionSchema.parse({
    tabs: tabs.value,
    activeKey: key,
    section: "files",
  });
  const restored = { value: [] };
  for (const tab of saved.tabs) ensureTab(restored, registry, tab.virtual, tab.params);
  assert.equal(restored.value[0].key, saved.activeKey);
  assert.equal(restored.value[0].virtual, "settings");
});

test("later groups replace base kinds and unknown kinds are not opened", () => {
  const base = singletonTab("network", "network:info", "Сеть", "Сеть");
  const registry = createTabRegistry([base], [issue, { ...base, path: () => "Другая" }]);
  assert.equal(registry.get("network").path({}), "Другая");
  assert.equal(registry.keyOf("network"), "network:info");
  assert.throws(() => registry.keyOf("agent"));
  const tabs = { value: [] };
  assert.equal(ensureTab(tabs, registry, "agent"), undefined);
  assert.equal(tabs.value.length, 0);
});

test("ensureTab keys a tab by its params and reuses an open one", () => {
  const registry = createTabRegistry([issue]);
  const tabs = { value: [] };
  assert.equal(ensureTab(tabs, registry, "issue", { number: 7, title: "Bug" }), "issue:7");
  assert.equal(ensureTab(tabs, registry, "issue", { number: 7 }), "issue:7");
  assert.equal(ensureTab(tabs, registry, "issue", { number: 8 }), "issue:8");
  assert.deepEqual(
    tabs.value.map((tab) => [tab.key, tab.virtual, tab.path, tab.content]),
    [
      ["issue:7", "issue", "Issue #7", "Bug"],
      ["issue:8", "issue", "Issue #8", ""],
    ],
  );
});

test("a preview kind opens as a preview unless pinned and a pinned tab stays pinned", () => {
  const registry = createTabRegistry([{ ...issue, preview: true }]);
  const tabs = { value: [] };
  ensureTab(tabs, registry, "issue", { number: 1 }, true);
  assert.equal(tabs.value[0].preview, true);
  ensureTab(tabs, registry, "issue", { number: 1 }, false);
  assert.equal(tabs.value[0].preview, false);
  ensureTab(tabs, registry, "issue", { number: 1 }, true);
  assert.equal(tabs.value[0].preview, false);
  ensureTab(tabs, registry, "issue", { number: 2 });
  assert.equal(tabs.value[1].preview, false);
});

test("a kind that is not a preview kind never opens as a preview", () => {
  const registry = createTabRegistry([issue]);
  const tabs = { value: [] };
  ensureTab(tabs, registry, "issue", { number: 3 }, true);
  assert.equal(tabs.value[0].preview, false);
});
