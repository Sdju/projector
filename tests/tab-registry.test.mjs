import assert from "node:assert/strict";
import { test } from "node:test";
import { createTabRegistry, defineTab, singletonTab } from "../src/modules/workspace-api/tabs.ts";
import { ensureTab } from "../src/modules/workspace/lib/service-tabs.ts";

const issue = defineTab({
  id: "issue",
  key: ({ number }) => `issue:${number}`,
  path: ({ number }) => `Issue #${number}`,
  title: ({ number }) => `Issue #${number}`,
  hint: ({ title }) => title ?? "",
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
