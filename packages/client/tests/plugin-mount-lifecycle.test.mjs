import { afterEach, expect, test } from "vite-plus/test";
import {
  addTab,
  mountContribution,
  runtimeTabs,
  runtimeIssues,
} from "../modules/plugin-runtime/store.ts";

afterEach(() => {
  runtimeTabs.value = [];
  runtimeIssues.value = [];
});

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

test("closing a view before async mount resolves still disposes its eventual resources once", async () => {
  let finish;
  const pending = new Promise((resolve) => (finish = resolve));
  let cleaned = 0;
  addTab(
    "async-view",
    { id: "tab", title: "Async view" },
    () => pending,
    (path) => path,
  );
  const dispose = mountContribution("tab", "async-view", "tab", {}, {});
  dispose();
  dispose();
  finish(() => cleaned++);
  await flush();
  expect(cleaned).toBe(1);
  dispose();
  expect(cleaned).toBe(1);
});

test("a mounted view cleans up once and cleanup failure stays associated with its package", async () => {
  let cleaned = 0;
  addTab(
    "broken-view",
    { id: "tab", title: "Broken view" },
    () => ({
      dispose() {
        cleaned++;
        throw new Error("view cleanup failed");
      },
    }),
    (path) => path,
  );
  const dispose = mountContribution("tab", "broken-view", "tab", {}, {});
  await flush();
  expect(() => dispose()).not.toThrow();
  dispose();
  expect(cleaned).toBe(1);
  expect(runtimeIssues.value).toContainEqual({
    plugin: "broken-view",
    phase: "cleanup",
    message: "view cleanup failed",
  });
});
